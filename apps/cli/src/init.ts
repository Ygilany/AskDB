import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_PATH = "askdb.config.ts";

/** Single template: only `askdb.config.ts` is written (kept in sync with the repo root `askdb.config.ts`). */
const CONFIG_TEMPLATE = `import "dotenv/config";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

// \`dotenv/config\` loads a local \`.env\` when this module runs (missing file is OK).
// CLIs call \`bootstrapAskDbEnv\`, which loads \`.env\` then evaluates this file and installs the AskDB runtime snapshot.
// Use \`env("VAR")\` for every value read from the environment; \`flattenAskDbConfig\` applies defaults
// for optional fields (see \`@askdb/config\` / \`defaults.ts\`).
export default defineConfig({
  ai: {
    // openai | azure | foundry (foundry uses Azure-compatible env vars) | google
    provider: "openai",
    providerConfig: {
      openai: {
        // Live NL→SQL: set in \`.env\`, e.g. OPENAI_API_KEY=… (optional OPENAI_BASE_URL=…)
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),
      },
    },
  },

  introspection: {
    // postgres | prisma | mysql | sqlite | sqlserver
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL for \`askdb introspect\` — maps to ASKDB_INTROSPECT_POSTGRES_URL
        databaseUrl: env("DATABASE_URL"),
      },
    },
    // Default Schema v2 output when you omit \`askdb introspect --out\` (maps to ASKDB_INTROSPECT_OUT)
    outputDir: env("MY_INTROSPECT_OUTPUT_DIR"),
  },

  rag: {
    // mock | openai | ai-sdk — optional: MY_RAG_EMBEDDER in \`.env\`
    embedder: "openai",
    embedderConfig: {
      openai: {
        model: env("ASKDB_RAG_EMBEDDER_MODEL"),
        dimension: env("ASKDB_RAG_EMBEDDER_DIMENSIONS"),
        apiKey: env("OPENAI_API_KEY"),
        baseUrl: env("ASKDB_RAG_EMBEDDER_BASE_URL"),
      },
    },
    // file | memory | pgvector — optional: ASKDB_PGVECTOR_URL for pgvector (e.g. port 5434 fixture)
    store: "file",
    storeConfig: {
      file: {},
      memory: {},
      pgvector: {
        databaseUrl: env("ASKDB_PGVECTOR_URL"),
        dimensions: env("ASKDB_RAG_EMBEDDER_DIMENSIONS"),
      },
    },
  },
  logging: {
    correlationId: env("ASKDB_CORRELATION_ID"),
  },
  dev: {
    mockSql: env("ASKDB_MOCK_SQL"),
  },
  studio: {
    listen: {
      host: env("ASKDB_STUDIO_HOST"),
      ...(env("ASKDB_STUDIO_PORT") ? { port: Number(env("ASKDB_STUDIO_PORT")) } : {}),
    },
    execute: {
      // Connection URL for the Studio playground query runner (maps to ASKDB_STUDIO_DATABASE_URL)
      databaseUrl: env("DATABASE_URL"),
    },
  },
  httpApi: {
    listen: {
      host: env("HOST"),
      ...(env("PORT") ? { port: Number(env("PORT")) } : {}),
    },
  },
} satisfies AskDbConfig);
`;

const require = createRequire(import.meta.url);

/** Walk upward from `startDir` to find a directory containing `package.json`. */
export function findNearestPackageJsonDir(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Monorepo / workspace root — avoid mutating root `package.json` from `askdb init`. */
export function isLikelyWorkspaceRoot(packageDir: string): boolean {
  if (existsSync(join(packageDir, "pnpm-workspace.yaml")) || existsSync(join(packageDir, "pnpm-workspace.yml"))) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { workspaces?: unknown };
    return pkg.workspaces !== undefined && pkg.workspaces !== null;
  } catch {
    return false;
  }
}

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export function detectPackageManager(packageDir: string): PackageManager {
  let dir = packageDir;
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "npm";
}

export type InitDepSpecs = { configSpec: string; dotenvSpec: string };

/** Resolve `@askdb/config` / `dotenv` semver specs for `askdb init` installs (published + monorepo dev). */
export function resolveInitDepSpecs(): InitDepSpecs {
  const cliPkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8")) as { dependencies?: Record<string, string> };
  const raw = cliPkg.dependencies?.["@askdb/config"] ?? "latest";
  let configSpec = raw;
  if (raw.startsWith("workspace:")) {
    try {
      const cfgPkgPath = require.resolve("@askdb/config/package.json");
      const v = JSON.parse(readFileSync(cfgPkgPath, "utf8")) as { version?: string };
      configSpec = v.version ?? "latest";
    } catch {
      configSpec = "latest";
    }
  }
  let dotenvSpec = "^16.6.1";
  try {
    const cfgPkgPath = require.resolve("@askdb/config/package.json");
    const cfg = JSON.parse(readFileSync(cfgPkgPath, "utf8")) as { dependencies?: { dotenv?: string } };
    if (cfg.dependencies?.dotenv) dotenvSpec = cfg.dependencies.dotenv;
  } catch {
    // keep default
  }
  return { configSpec, dotenvSpec };
}

function formatDepArgs(specs: InitDepSpecs): [string, string] {
  const configArg = `@askdb/config@${specs.configSpec}`;
  const dotenvArg = `dotenv@${specs.dotenvSpec}`;
  return [configArg, dotenvArg];
}

function runPackageManagerInstall(pm: PackageManager, packageDir: string, specs: InitDepSpecs): boolean {
  const [c, d] = formatDepArgs(specs);
  const env = { ...process.env, CI: process.env.CI ?? "true" };
  const win = process.platform === "win32";
  let cmd: string;
  let args: string[];
  switch (pm) {
    case "pnpm":
      cmd = win ? "pnpm.CMD" : "pnpm";
      args = ["add", c, d];
      break;
    case "yarn":
      cmd = win ? "yarn.cmd" : "yarn";
      args = ["add", c, d];
      break;
    case "bun":
      cmd = win ? "bun.exe" : "bun";
      args = ["add", c, d];
      break;
    default:
      cmd = win ? "npm.cmd" : "npm";
      args = ["install", "--save", c, d];
  }
  const r = spawnSync(cmd, args, { cwd: packageDir, stdio: "inherit", env, shell: false });
  return r.status === 0;
}

type InitOptions = {
  force: boolean;
  path: string;
  skipInstall: boolean;
};

export function runInitCli(argv: readonly string[]): number {
  let opts: InitOptions;
  try {
    opts = parseOptions(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    return 1;
  }

  if (opts.path === "--help" || opts.path === "-h") {
    printHelp();
    return 0;
  }

  const configTarget = resolve(process.cwd(), opts.path);

  if (existsSync(configTarget) && !opts.force) {
    process.stderr.write(
      `Refusing to overwrite existing file:\n` +
        `  - ${configTarget}\n` +
        `Use \`askdb init --force\` to overwrite.\n`,
    );
    return 1;
  }

  try {
    writeFileSync(configTarget, CONFIG_TEMPLATE, { encoding: "utf8" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Failed to write init template: ${msg}\n`);
    return 1;
  }

  process.stdout.write(`Wrote:\n  - ${configTarget}\n`);

  if (!opts.skipInstall) {
    const pkgRoot = findNearestPackageJsonDir(process.cwd());
    const specs = resolveInitDepSpecs();
    const [cArg, dArg] = formatDepArgs(specs);

    if (!pkgRoot) {
      process.stdout.write(
        "\nNo package.json found in this directory or any parent directory.\n" +
          "Install the template imports yourself (from a project with a package.json):\n" +
          `  npm install --save ${cArg} ${dArg}\n\n`,
      );
    } else if (isLikelyWorkspaceRoot(pkgRoot)) {
      process.stdout.write(
        "\nSkipped automatic dependency install (workspace / monorepo root).\n" +
          "Add these to the package that will load this config (or run `askdb init` from that package directory):\n" +
          `  npm install --save ${cArg} ${dArg}\n\n`,
      );
    } else {
      const pm = detectPackageManager(pkgRoot);
      process.stdout.write(`\nInstalling template dependencies with ${pm} in ${pkgRoot} …\n`);
      const ok = runPackageManagerInstall(pm, pkgRoot, specs);
      if (!ok) {
        process.stderr.write(
          "Dependency install failed. The config file was written, but @askdb/config and dotenv are not installed yet.\n" +
            `  cd ${pkgRoot}\n` +
            `  ${formatManualInstallCommand(pm, specs)}\n`,
        );
        return 1;
      }
      process.stdout.write("Installed @askdb/config and dotenv.\n");
    }
  }

  process.stdout.write(
    "\nNext steps:\n" +
      "  1. Create a `.env` (optional) or export variables to match the `env(\"...\")` calls in this file — see the header comment for examples.\n" +
      "  2. For live NL→SQL, set an OpenAI-compatible key (or use ASKDB_MOCK_SQL in tests).\n" +
      "  3. For a Schema v2 directory from Postgres/Prisma: `askdb introspect ...` (see --help). With MY_INTROSPECT_OUTPUT_DIR / ASKDB_INTROSPECT_OUT you can omit `--out` when a default output dir is set.\n" +
      "  4. With an existing schema artifact: `askdb ask --schema <path> --question \"...\"`.\n",
  );
  return 0;
}

function formatManualInstallCommand(pm: PackageManager, specs: InitDepSpecs): string {
  const [c, d] = formatDepArgs(specs);
  switch (pm) {
    case "pnpm":
      return `pnpm add ${c} ${d}`;
    case "yarn":
      return `yarn add ${c} ${d}`;
    case "bun":
      return `bun add ${c} ${d}`;
    default:
      return `npm install --save ${c} ${d}`;
  }
}

function parseOptions(argv: readonly string[]): InitOptions {
  const opts: InitOptions = { force: false, path: DEFAULT_CONFIG_PATH, skipInstall: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--force":
      case "-f":
        opts.force = true;
        break;
      case "--skip-install":
        opts.skipInstall = true;
        break;
      case "--path": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`${arg} requires a value.`);
        }
        opts.path = value;
        break;
      }
      case "--help":
      case "-h":
        opts.path = "--help";
        return opts;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb init - Create askdb.config.ts (nested defineConfig template with env() examples and .env guidance in comments)",
      "",
      "Usage:",
      "  askdb init                    Create ./askdb.config.ts (refuses to overwrite unless --force)",
      "  askdb init --force            Overwrite an existing askdb.config.ts",
      "  askdb init --path <file>      Write the template to a custom file path",
      "  askdb init --skip-install     Only write askdb.config.ts (do not install @askdb/config / dotenv)",
      "",
    ].join("\n"),
  );
}
