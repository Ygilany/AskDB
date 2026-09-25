import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve, isAbsolute, relative } from "node:path";
import { getBuiltinAiProviderSetup } from "@askdb/ai";
import {
  ASKDB_AI_PROVIDERS,
  bootstrapAskDbEnv,
  discoverAskDbConfigPath,
  getAskDbRuntimeConfig,
  type AskDbAiProviderId,
} from "@askdb/config";
import {
  formatInstallCommand,
  lockfilePackageManager,
  packageManagerAddArgs,
  packageManagerSpawnSpec,
  type PackageManager,
} from "./package-manager.js";

export type SetupDatabase = "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
/** Any provider id with an `askdb.config.*` branch (`ASKDB_AI_PROVIDERS` in `@askdb/config`). */
export type SetupAiProvider = AskDbAiProviderId;
export type SetupRagStore = "file" | "memory" | "pgvector";
export type SetupExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

export type SetupConfigInput = {
  database: SetupDatabase;
  /** Env var NAME (never a value) for the connection URL. Network engines only. */
  connectionEnv?: string;
  /** SQLite file path, relative to the project root. */
  sqliteFile?: string;
  /** Prisma schema path, relative to the project root. Empty = auto-discovery. */
  prismaSchema?: string;
  aiProvider: SetupAiProvider;
  /** Env var NAME (never a value) for the model API key. */
  aiKeyEnv?: string;
  /** Env var NAME (never a value) for the model override. Omit to skip. */
  aiModelEnv?: string;
  /** Schema artifact output directory, relative to the project root. */
  schemaOut?: string;
  /** Defaults to "file" — no setup required. */
  ragStore?: SetupRagStore;
  /** Env var NAME (never a value) for the pgvector connection URL. Only used when ragStore is "pgvector". */
  pgvectorEnv?: string;
  /** Enable Studio execute (run queries from the browser playground). */
  studioExecute?: boolean;
  /** Required when studioExecute is enabled and database is "prisma" (no live provider to default to). */
  studioExecuteProvider?: SetupExecuteProvider;
  studioExecuteConnectionEnv?: string;
  studioExecuteSqliteFile?: string;
};

/**
 * Key/model env var names to scaffold for a provider, from `@askdb/ai`'s built-in
 * provider table — the same source `askdb init` uses, so the two cannot drift.
 */
function aiDefaults(provider: string): { keyEnv: string; modelEnv: string } | undefined {
  if (!(ASKDB_AI_PROVIDERS as readonly string[]).includes(provider)) return undefined;
  return getBuiltinAiProviderSetup(provider);
}

const CONNECTION_ENV_DEFAULTS: Record<Exclude<SetupDatabase, "sqlite" | "prisma">, string> = {
  postgres: "DATABASE_URL",
  mysql: "DATABASE_URL",
  sqlserver: "DATABASE_URL",
};

const EXECUTE_CONNECTION_ENV_DEFAULTS: Record<Exclude<SetupExecuteProvider, "sqlite">, string> = {
  postgres: "DATABASE_URL",
  mysql: "DATABASE_URL",
  sqlserver: "DATABASE_URL",
};

const EXECUTE_PROVIDERS = ["postgres", "mysql", "sqlite", "sqlserver"] as const satisfies readonly SetupExecuteProvider[];

const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// C0 controls, DEL, and the JS line/paragraph separators — never legitimate in a project path.
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;

/**
 * Render a value as a TypeScript string literal for the generated
 * `askdb.config.ts`. Every interpolated value goes through this — the file is
 * later executed (via jiti) by Studio and the CLI, so a raw `"${value}"` would
 * let a quote in a path inject code.
 */
function tsString(value: string): string {
  return JSON.stringify(value);
}

const DB_URL_PLACEHOLDER: Partial<Record<SetupDatabase | SetupExecuteProvider, string>> = {
  postgres: "postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
  mysql: "mysql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
  sqlserver:
    "Data Source=<DATABASE_HOST>,<DATABASE_PORT>;Initial Catalog=<DATABASE_NAME>;User ID=<USERNAME>;Password=<PASSWORD>;Trust Server Certificate=True;Authentication=SqlPassword;",
};

/** Live-introspection driver per engine — mirrors `DB_DRIVER_PACKAGES` in `apps/cli/src/init.ts`. */
const DB_DRIVER_PACKAGES: Partial<Record<SetupDatabase, string>> = {
  postgres: "pg",
  mysql: "mysql2",
  sqlite: "better-sqlite3",
  sqlserver: "mssql",
};

type EnvVarEntry = { name: string; purpose: string; requiredForIntrospection: boolean; exampleValue?: string };

function pushEnvVar(envVars: EnvVarEntry[], entry: EnvVarEntry): void {
  if (envVars.some((v) => v.name === entry.name)) return;
  envVars.push(entry);
}

/** Mirrors `renderRagSection` in `apps/cli/src/init.ts` — keep the two in sync. */
function renderRagSection(ragStore: SetupRagStore, pgvectorEnv: string | undefined): string {
  switch (ragStore) {
    case "file":
      return `  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "file",
    storeConfig: { file: {} },
  },`;
    case "memory":
      return `  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },`;
    case "pgvector":
      return `  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "pgvector",
    storeConfig: {
      pgvector: {
        databaseUrl: env(${tsString(pgvectorEnv ?? "ASKDB_PGVECTOR_URL")}),
      },
    },
  },`;
  }
}

export type SetupConfigResult = {
  configPath: string;
  envExamplePath: string | null;
  /** Env var names the user must fill in `.env` before introspecting / asking. */
  envVars: EnvVarEntry[];
  /** Packages installed into the project (null when nothing was needed). */
  installed: string[] | null;
  /** Set when automatic install wasn't possible — run this, then introspect. */
  manualInstallCommand: string | null;
  /** True when the wizard had to create a minimal package.json first. */
  packageJsonCreated: boolean;
};

/**
 * Write `askdb.config.ts` (and `.env.example`) into `cwd`. Accepts env var
 * NAMES only — secret values never travel through this endpoint. Refuses to
 * overwrite an existing config. Templates mirror `askdb init`'s output.
 */
export function writeSetupConfig(cwd: string, input: SetupConfigInput): SetupConfigResult {
  const existing = discoverAskDbConfigPath(cwd);
  if (existing) {
    throw new SetupError(409, `A config already exists at ${existing}. Edit it directly instead.`);
  }

  const schemaOut = validateRelativePath(input.schemaOut ?? "./askdb", "schemaOut");
  // Allowlist lookup (ASKDB_AI_PROVIDERS) so `constructor`/`__proto__` can't masquerade as a
  // provider — the provider name is emitted as an object key in the generated config.
  const providerDefaults = aiDefaults(input.aiProvider);
  if (!providerDefaults) throw new SetupError(400, `Unknown AI provider: ${JSON.stringify(input.aiProvider)}`);
  const aiKeyEnv = validateEnvName(input.aiKeyEnv ?? providerDefaults.keyEnv, "aiKeyEnv");
  const aiModelEnv = input.aiModelEnv ? validateEnvName(input.aiModelEnv, "aiModelEnv") : undefined;

  const envVars: SetupConfigResult["envVars"] = [
    { name: aiKeyEnv, purpose: `${input.aiProvider} API key`, requiredForIntrospection: false },
  ];
  if (aiModelEnv) {
    envVars.push({ name: aiModelEnv, purpose: `${input.aiProvider} model override`, requiredForIntrospection: false });
  }

  let introspectionSection: string;
  switch (input.database) {
    case "postgres":
    case "mysql":
    case "sqlserver": {
      const connectionEnv = validateEnvName(
        input.connectionEnv ?? CONNECTION_ENV_DEFAULTS[input.database],
        "connectionEnv",
      );
      envVars.push({
        name: connectionEnv,
        purpose: `${input.database} connection URL (introspection only)`,
        requiredForIntrospection: true,
        exampleValue: DB_URL_PLACEHOLDER[input.database],
      });
      introspectionSection = `  introspection: {
    provider: ${tsString(input.database)},
    providerConfig: {
      ${input.database}: {
        databaseUrl: env(${tsString(connectionEnv)}),
      },
    },
    outputDir: ${tsString(schemaOut)},
  },`;
      break;
    }
    case "sqlite": {
      const file = validateRelativePath(input.sqliteFile ?? "./data.db", "sqliteFile");
      introspectionSection = `  introspection: {
    provider: "sqlite",
    providerConfig: {
      sqlite: {
        file: ${tsString(file)},
      },
    },
    outputDir: ${tsString(schemaOut)},
  },`;
      break;
    }
    case "prisma": {
      const schemaLine = input.prismaSchema
        ? `\n        schemaPath: ${tsString(validateRelativePath(input.prismaSchema, "prismaSchema"))},`
        : "";
      introspectionSection = `  introspection: {
    provider: "prisma",
    providerConfig: {
      prisma: {${schemaLine}
      },
    },
    outputDir: ${tsString(schemaOut)},
  },`;
      break;
    }
    default:
      throw new SetupError(400, `Unknown database: ${String(input.database)}`);
  }

  const ragStore = input.ragStore ?? "file";
  let pgvectorEnv: string | undefined;
  if (ragStore === "pgvector") {
    pgvectorEnv = validateEnvName(input.pgvectorEnv ?? "ASKDB_PGVECTOR_URL", "pgvectorEnv");
    pushEnvVar(envVars, {
      name: pgvectorEnv,
      purpose: "pgvector connection URL",
      requiredForIntrospection: false,
      exampleValue: "postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
    });
  }
  const ragSection = renderRagSection(ragStore, pgvectorEnv);

  let studioSection: string | null = null;
  let studioExecuteProvider: SetupExecuteProvider | undefined;
  if (input.studioExecute) {
    studioExecuteProvider =
      input.studioExecuteProvider ?? (input.database !== "prisma" ? input.database : undefined);
    if (!studioExecuteProvider) {
      throw new SetupError(400, "`studioExecuteProvider` is required when `studioExecute` is enabled and `database` is \"prisma\".");
    }
    if (!(EXECUTE_PROVIDERS as readonly string[]).includes(studioExecuteProvider)) {
      throw new SetupError(400, `Unknown studioExecuteProvider: ${JSON.stringify(studioExecuteProvider)}`);
    }
    if (studioExecuteProvider === "sqlite") {
      const file = validateRelativePath(input.studioExecuteSqliteFile ?? input.sqliteFile ?? "./data.db", "studioExecuteSqliteFile");
      studioSection = `  studio: {
    execute: {
      enabled: true,
      provider: "sqlite",
      file: ${tsString(file)},
    },
  },`;
    } else {
      const execConnectionEnv = validateEnvName(
        input.studioExecuteConnectionEnv ?? EXECUTE_CONNECTION_ENV_DEFAULTS[studioExecuteProvider],
        "studioExecuteConnectionEnv",
      );
      pushEnvVar(envVars, {
        name: execConnectionEnv,
        purpose: `${studioExecuteProvider} connection URL (Studio execute)`,
        requiredForIntrospection: false,
        exampleValue: DB_URL_PLACEHOLDER[studioExecuteProvider],
      });
      studioSection = `  studio: {
    execute: {
      enabled: true,
      provider: ${tsString(studioExecuteProvider)},
      databaseUrl: env(${tsString(execConnectionEnv)}),
    },
  },`;
    }
  }

  const modelLine = aiModelEnv ? `\n        model: env(${tsString(aiModelEnv)}),` : "";
  const sections = [introspectionSection, ragSection, studioSection].filter((s): s is string => s !== null);

  const config = `import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: ${tsString(input.aiProvider)},
    providerConfig: {
      ${input.aiProvider}: {
        apiKey: env(${tsString(aiKeyEnv)}),${modelLine}
      },
    },
  },
${sections.join("\n")}
} satisfies AskDbConfig);
`;

  const configPath = join(cwd, "askdb.config.ts");
  writeFileSync(configPath, config, "utf8");

  let envExamplePath: string | null = join(cwd, ".env.example");
  if (existsSync(envExamplePath)) {
    envExamplePath = null; // don't clobber an existing example file
  } else {
    const example = [
      "# AskDB environment — copy to .env and fill in real values.",
      "# .env is read by Studio, the CLI, and the HTTP API; never commit it.",
      ...envVars.map((v) =>
        v.exampleValue ? `${v.name}=${v.exampleValue}` : `${v.name}= # ${v.purpose}`,
      ),
      "",
    ].join("\n");
    writeFileSync(envExamplePath, example, "utf8");
  }

  // The config imports `@askdb/config`, so the project needs it (plus the
  // live-introspection driver and, if enabled, the Studio execute driver)
  // installed — same as `askdb init` does.
  const deps = ensureProjectDependencies(cwd, input.database, studioExecuteProvider);

  // Install the runtime snapshot from the file we just wrote so the rest of
  // the server (and the introspection step) sees the new config immediately.
  // Skipped when dependencies are still missing, or when the config can't
  // load yet (e.g. `.env` isn't filled in — pgvector's `databaseUrl` must
  // resolve at load time, unlike introspection URLs) — probeSetupState
  // retries later and surfaces the load error.
  if (!deps.manualInstallCommand) {
    try {
      bootstrapAskDbEnv({ cwd });
    } catch {
      // probeSetupState re-attempts this after the caller fills in `.env`.
    }
  }

  return {
    configPath,
    envExamplePath,
    envVars,
    installed: deps.installed,
    manualInstallCommand: deps.manualInstallCommand,
    packageJsonCreated: deps.packageJsonCreated,
  };
}

type EnsureDepsResult = {
  installed: string[] | null;
  manualInstallCommand: string | null;
  packageJsonCreated: boolean;
};

/**
 * Make sure the project can load the config we just wrote: `@askdb/config` +
 * `dotenv` must be resolvable from the project, and live engines need their
 * introspection driver. Mirrors `askdb init`'s install plan. Falls back to a
 * manual command when the project looks like a workspace root or the install
 * fails — never mutates a monorepo root implicitly.
 */
function ensureProjectDependencies(
  cwd: string,
  database: SetupDatabase,
  studioExecuteProvider?: SetupExecuteProvider,
): EnsureDepsResult {
  const missing: string[] = [];
  if (!canResolveFrom(cwd, "@askdb/config")) {
    missing.push(`@askdb/config@${resolveConfigSpec()}`);
  }
  const driversNeeded = new Set<string>();
  if (DB_DRIVER_PACKAGES[database]) driversNeeded.add(database);
  if (studioExecuteProvider && DB_DRIVER_PACKAGES[studioExecuteProvider]) driversNeeded.add(studioExecuteProvider);
  for (const db of driversNeeded) {
    const driver = DB_DRIVER_PACKAGES[db as SetupDatabase];
    if (driver && !canResolveFrom(cwd, driver) && !missing.includes(driver)) {
      missing.push(driver);
    }
  }
  if (missing.length === 0) {
    return { installed: null, manualInstallCommand: null, packageJsonCreated: false };
  }

  let packageJsonCreated = false;
  const nearestPkgDir = findNearestPackageJsonDir(cwd);
  if (!nearestPkgDir) {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name: basename(cwd) || "askdb-project", private: true }, null, 2)}\n`,
      "utf8",
    );
    packageJsonCreated = true;
  }
  const pkgDir = nearestPkgDir ?? cwd;

  const pm = detectPackageManager(pkgDir);
  // Only auto-install when the project manifest sits exactly at the wizard's
  // directory. A package.json found further up might be a monorepo root or an
  // unrelated project — never mutate those implicitly.
  if (pkgDir !== resolve(cwd) || (isLikelyWorkspaceRoot(pkgDir) && !packageJsonCreated)) {
    return {
      installed: null,
      manualInstallCommand: formatInstallCommand(pm, missing),
      packageJsonCreated,
    };
  }

  const installer = setupInstallerForTests ?? runInstall;
  const ok = installer(pm, pkgDir, missing);
  if (!ok) {
    return {
      installed: null,
      manualInstallCommand: formatInstallCommand(pm, missing),
      packageJsonCreated,
    };
  }
  return { installed: missing, manualInstallCommand: null, packageJsonCreated };
}

function canResolveFrom(dir: string, packageName: string): boolean {
  try {
    // Resolve the package entry point, not `<pkg>/package.json` — the latter
    // fails for packages whose `exports` map doesn't expose "./package.json".
    createRequire(join(dir, "package.json")).resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the `package.json` of the `@askdb/config` copy Studio itself runs
 * with. `require.resolve("@askdb/config/package.json")` fails because the
 * package's `exports` map doesn't expose it — resolve the entry point and
 * walk up instead.
 */
function readStudioConfigPackageJson(): { version?: string } | undefined {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@askdb/config");
    const pkgDir = findNearestPackageJsonDir(dirname(entry));
    if (!pkgDir) return undefined;
    return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { version?: string };
  } catch {
    return undefined;
  }
}

/** Pin `@askdb/config` to the version Studio itself was built against. */
function resolveConfigSpec(): string {
  return readStudioConfigPackageJson()?.version ?? "latest";
}

function findNearestPackageJsonDir(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function isLikelyWorkspaceRoot(packageDir: string): boolean {
  if (
    existsSync(join(packageDir, "pnpm-workspace.yaml")) ||
    existsSync(join(packageDir, "pnpm-workspace.yml"))
  ) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
    return pkg.workspaces !== undefined && pkg.workspaces !== null;
  } catch {
    return false;
  }
}

type SetupInstaller = (pm: PackageManager, packageDir: string, packages: string[]) => boolean;

let setupInstallerForTests: SetupInstaller | undefined;

/** @internal Tests only — replaces the real package-manager install. */
export function setSetupInstallerForTests(installer: SetupInstaller | undefined): void {
  setupInstallerForTests = installer;
}

function detectPackageManager(packageDir: string): PackageManager {
  let dir = packageDir;
  for (let i = 0; i < 40; i += 1) {
    const pm = lockfilePackageManager(dir);
    if (pm) return pm;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "npm";
}

function runInstall(pm: PackageManager, packageDir: string, packages: string[]): boolean {
  const env = { ...process.env, CI: process.env.CI ?? "true" };
  try {
    const { command, args, shell } = packageManagerSpawnSpec(pm, packageManagerAddArgs(pm, packages));
    const result = spawnSync(command, args, { cwd: packageDir, stdio: "ignore", env, shell });
    return result.status === 0;
  } catch {
    return false;
  }
}

export type SetupProbe = {
  hasConfig: boolean;
  configPath: string | null;
  hasArtifact: boolean;
  outputDir: string | null;
  /** Config exists on disk but couldn't be loaded (e.g. deps not installed yet). */
  loadError: string | null;
};

/** Re-check the on-disk state (config file, schema artifact) for setup routing. */
export function probeSetupState(cwd: string): SetupProbe {
  const configPath = discoverAskDbConfigPath(cwd) ?? null;
  if (!configPath) {
    return { hasConfig: false, configPath: null, hasArtifact: false, outputDir: null, loadError: null };
  }
  try {
    // Re-bootstrap so config/.env edits made since server start are honored.
    bootstrapAskDbEnv({ cwd });
    const outputDir = resolve(cwd, getAskDbRuntimeConfig().introspection.outputDir);
    return {
      hasConfig: true,
      configPath,
      hasArtifact: existsSync(join(outputDir, "schema.json")),
      outputDir,
      loadError: null,
    };
  } catch (error) {
    return {
      hasConfig: true,
      configPath,
      hasArtifact: false,
      outputDir: null,
      loadError: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateEnvName(name: string, field: string): string {
  const trimmed = name.trim();
  if (!ENV_NAME_PATTERN.test(trimmed)) {
    throw new SetupError(
      400,
      `\`${field}\` must be an environment variable NAME like DATABASE_URL (got: ${JSON.stringify(name)}). Values belong in .env, not here.`,
    );
  }
  return trimmed;
}

function validateRelativePath(path: string, field: string): string {
  const trimmed = path.trim();
  if (
    trimmed === "" ||
    isAbsolute(trimmed) ||
    relative(".", trimmed).startsWith("..") ||
    CONTROL_CHAR_PATTERN.test(trimmed)
  ) {
    throw new SetupError(
      400,
      `\`${field}\` must be a relative path inside the project (got: ${JSON.stringify(path)}).`,
    );
  }
  return trimmed;
}

export class SetupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SetupError";
  }
}
