import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBuiltinAiProviderSetup, listBuiltinAiProviderSetups } from "@askdb/ai";
import { ASKDB_AI_PROVIDERS, type AskDbAiProviderId } from "@askdb/config";

const DEFAULT_CONFIG_PATH = "askdb.config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InitAnswers = {
  database: "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
  connectionEnv?: string;
  sqliteFile?: string;
  prismaSchema?: string;
  schemaOut: string;
  aiProvider: AskDbAiProviderId;
  aiKeyEnv: string;
  aiModelEnv?: string;
  ragStore: "file" | "memory" | "pgvector";
  pgvectorEnv?: string;
  studioExecute:
    | { enabled: false }
    | {
        enabled: true;
        provider: "postgres" | "mysql" | "sqlite" | "sqlserver";
        connectionEnv?: string;
        sqliteFile?: string;
      };
};

export type InitPrompter = {
  select<T extends string>(opts: {
    message: string;
    choices: Array<{ name: string; value: T }>;
    default?: T;
  }): Promise<T>;
  input(opts: {
    message: string;
    default?: string;
    validate?: (value: string) => true | string;
  }): Promise<string>;
  confirm(opts: {
    message: string;
    default?: boolean;
  }): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Config rendering
// ---------------------------------------------------------------------------

/**
 * Selectable AI providers, in `@askdb/ai`'s built-in table order: every id that has an
 * `askdb.config.*` branch (`ASKDB_AI_PROVIDERS`), with the key/model env var names to
 * scaffold. Derived from `@askdb/ai`'s `BUILTIN_AI_PROVIDERS` so it cannot drift.
 */
const AI_PROVIDER_SETUPS = listBuiltinAiProviderSetups(ASKDB_AI_PROVIDERS);
const VALID_AI_PROVIDERS = AI_PROVIDER_SETUPS.map((setup) => setup.id as AskDbAiProviderId);

function aiDefaults(provider: AskDbAiProviderId): { keyEnv: string; modelEnv: string } {
  const setup = getBuiltinAiProviderSetup(provider);
  if (!setup) throw new Error(`askdb init: "${provider}" is not a built-in AI provider.`);
  return setup;
}

/**
 * Render a value as a TypeScript string literal for the generated config.
 * Every interpolated value goes through this — the file is later executed
 * (via jiti), so a raw `"${value}"` would let a quote in a path inject code.
 * Mirrors `tsString` in `apps/studio/src/setup.ts`.
 */
function tsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Azure / Foundry also need the resource name (or a full endpoint URL) — the
 * adapter refuses to start without one. Scaffold the resource-name form; users
 * can swap it for `baseUrl` if they use a custom endpoint.
 */
const AZURE_RESOURCE_NAME_ENV = "AZURE_RESOURCE_NAME";

function azureResourceEnv(answers: InitAnswers): string | undefined {
  return answers.aiProvider === "azure" || answers.aiProvider === "foundry"
    ? AZURE_RESOURCE_NAME_ENV
    : undefined;
}

function renderAiSection(answers: InitAnswers): string {
  const { aiProvider, aiKeyEnv, aiModelEnv } = answers;
  const modelLine = aiModelEnv ? `\n        model: env(${tsString(aiModelEnv)}),` : "";
  const resourceEnv = azureResourceEnv(answers);
  const resourceLine = resourceEnv ? `\n        resourceName: env(${tsString(resourceEnv)}),` : "";
  return `  ai: {
    provider: ${tsString(aiProvider)},
    providerConfig: {
      ${aiProvider}: {
        apiKey: env(${tsString(aiKeyEnv)}),${modelLine}${resourceLine}
      },
    },
  },`;
}

function renderIntrospectionSection(answers: InitAnswers): string {
  const { database, connectionEnv, sqliteFile, prismaSchema, schemaOut } = answers;
  const outputDirLine = `\n    outputDir: ${tsString(schemaOut)},`;
  const connectionEnvExpr = `env(${tsString(connectionEnv ?? "DATABASE_URL")})`;
  switch (database) {
    case "postgres":
      return `  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: {
        databaseUrl: ${connectionEnvExpr},
      },
    },${outputDirLine}
  },`;
    case "mysql":
      return `  introspection: {
    provider: "mysql",
    providerConfig: {
      mysql: {
        databaseUrl: ${connectionEnvExpr},
      },
    },${outputDirLine}
  },`;
    case "sqlite": {
      const fileExpr = sqliteFile && !sqliteFile.startsWith("./") && !sqliteFile.startsWith("/")
        ? `env(${tsString(sqliteFile)})`
        : `env("SQLITE_FILE")`;
      const resolvedFile = sqliteFile && (sqliteFile.startsWith("./") || sqliteFile.startsWith("/"))
        ? tsString(sqliteFile)
        : fileExpr;
      return `  introspection: {
    provider: "sqlite",
    providerConfig: {
      sqlite: {
        file: ${resolvedFile},
      },
    },${outputDirLine}
  },`;
    }
    case "sqlserver":
      return `  introspection: {
    provider: "sqlserver",
    providerConfig: {
      sqlserver: {
        databaseUrl: ${connectionEnvExpr},
      },
    },${outputDirLine}
  },`;
    case "prisma": {
      const schemaLine = prismaSchema ? `\n        schemaPath: ${tsString(prismaSchema)},` : "";
      return `  introspection: {
    provider: "prisma",
    providerConfig: {
      prisma: {${schemaLine}
      },
    },${outputDirLine}
  },`;
    }
  }
}

function renderRagSection(answers: InitAnswers): string {
  const { ragStore, pgvectorEnv } = answers;
  switch (ragStore) {
    case "file":
      return `  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "file",
    storeConfig: {
      file: {},
    },
  },`;
    case "memory":
      return `  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: {
      memory: {},
    },
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

function renderStudioSection(answers: InitAnswers): string | null {
  const { studioExecute } = answers;
  if (!studioExecute.enabled) return null;

  const { provider } = studioExecute;
  if (provider === "sqlite") {
    const fileExpr = studioExecute.sqliteFile && (studioExecute.sqliteFile.startsWith("./") || studioExecute.sqliteFile.startsWith("/"))
      ? tsString(studioExecute.sqliteFile)
      : `env(${tsString(studioExecute.sqliteFile ?? "SQLITE_FILE")})`;
    return `  studio: {
    execute: {
      enabled: true,
      provider: "sqlite",
      file: ${fileExpr},
    },
  },`;
  }

  const urlEnv = studioExecute.connectionEnv ?? "DATABASE_URL";
  return `  studio: {
    execute: {
      enabled: true,
      provider: ${tsString(provider)},
      databaseUrl: env(${tsString(urlEnv)}),
    },
  },`;
}

export function renderInitConfig(answers: InitAnswers): string {
  const sections: string[] = [
    renderAiSection(answers),
    renderIntrospectionSection(answers),
    renderRagSection(answers),
  ];

  const studio = renderStudioSection(answers);
  if (studio) sections.push(studio);

  return `import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
${sections.join("\n")}
} satisfies AskDbConfig);
`;
}

// ---------------------------------------------------------------------------
// Default answers
// ---------------------------------------------------------------------------

type InitAnswerOverrides = Partial<{
  database: InitAnswers["database"];
  connectionEnv: string;
  sqliteFile: string;
  prismaSchema: string;
  schemaOut: string;
  aiProvider: InitAnswers["aiProvider"];
  aiKeyEnv: string;
  aiModelEnv: string;
  ragStore: InitAnswers["ragStore"];
  pgvectorEnv: string;
  studioExecute: boolean;
  studioExecuteProvider: "postgres" | "mysql" | "sqlite" | "sqlserver";
  studioExecuteConnectionEnv: string;
  studioExecuteSqliteFile: string;
}>;

export function resolveDefaultInitAnswers(overrides: InitAnswerOverrides = {}): InitAnswers {
  const database = overrides.database ?? "postgres";
  const aiProvider = overrides.aiProvider ?? "openai";
  const providerDefaults = aiDefaults(aiProvider);

  let connectionEnv = overrides.connectionEnv;
  if (!connectionEnv) {
    connectionEnv = database === "sqlite" ? undefined : "DATABASE_URL";
  }

  const studioEnabled = overrides.studioExecute ?? false;
  let studioExecute: InitAnswers["studioExecute"];
  if (studioEnabled) {
    const execProvider =
      overrides.studioExecuteProvider ??
      (database !== "prisma" ? (database as "postgres" | "mysql" | "sqlite" | "sqlserver") : "postgres");
    studioExecute = {
      enabled: true,
      provider: execProvider,
      connectionEnv: overrides.studioExecuteConnectionEnv ?? (execProvider === "sqlite" ? undefined : "DATABASE_URL"),
      sqliteFile: overrides.studioExecuteSqliteFile ?? (execProvider === "sqlite" ? overrides.sqliteFile : undefined),
    };
  } else {
    studioExecute = { enabled: false };
  }

  return {
    database,
    connectionEnv,
    sqliteFile: overrides.sqliteFile,
    prismaSchema: overrides.prismaSchema,
    schemaOut: overrides.schemaOut ?? "./askdb",
    aiProvider,
    aiKeyEnv: overrides.aiKeyEnv ?? providerDefaults.keyEnv,
    aiModelEnv: overrides.aiModelEnv ?? providerDefaults.modelEnv,
    ragStore: overrides.ragStore ?? "file",
    pgvectorEnv: overrides.pgvectorEnv,
    studioExecute,
  };
}

// ---------------------------------------------------------------------------
// Install plan
// ---------------------------------------------------------------------------

export type InitInstallPlan = {
  packages: string[];
  labels: string[];
};

/** Package maps — names come from an allowlist, not from user input */
const DB_DRIVER_PACKAGES: Record<string, string> = {
  postgres: "pg",
  mysql: "mysql2",
  sqlite: "better-sqlite3",
  sqlserver: "mssql",
};

export type InitDepSpecs = { configSpec: string };

export function buildInitInstallPlan(answers: InitAnswers, specs: InitDepSpecs): InitInstallPlan {
  const packages: string[] = [
    `@askdb/config@${specs.configSpec}`,
  ];
  const labels: string[] = ["@askdb/config"];

  const driversNeeded = new Set<string>();

  // Live DB driver for introspection
  if (answers.database !== "prisma") {
    driversNeeded.add(answers.database);
  }

  // Live DB driver for Studio execute
  if (answers.studioExecute.enabled) {
    driversNeeded.add(answers.studioExecute.provider);
  }

  for (const db of driversNeeded) {
    const pkg = DB_DRIVER_PACKAGES[db];
    if (pkg) {
      packages.push(pkg);
      labels.push(pkg);
    }
  }

  return { packages, labels };
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

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

/** Resolve `@askdb/config` semver spec for `askdb init` installs (published + monorepo dev). */
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
  return { configSpec };
}

// ---------------------------------------------------------------------------
// Package manager install
// ---------------------------------------------------------------------------

type InstallFn = (pm: PackageManager, packageDir: string, packages: string[]) => boolean;

function defaultInstaller(pm: PackageManager, packageDir: string, packages: string[]): boolean {
  const env = { ...process.env, CI: process.env.CI ?? "true" };
  const win = process.platform === "win32";
  let cmd: string;
  let args: string[];
  switch (pm) {
    case "pnpm":
      cmd = win ? "pnpm.CMD" : "pnpm";
      args = ["add", ...packages];
      break;
    case "yarn":
      cmd = win ? "yarn.cmd" : "yarn";
      args = ["add", ...packages];
      break;
    case "bun":
      cmd = win ? "bun.exe" : "bun";
      args = ["add", ...packages];
      break;
    default:
      cmd = win ? "npm.cmd" : "npm";
      args = ["install", "--save", ...packages];
  }
  const r = spawnSync(cmd, args, { cwd: packageDir, stdio: "inherit", env, shell: false });
  return r.status === 0;
}

function formatManualInstallCommand(pm: PackageManager, packages: string[]): string {
  const pkgList = packages.join(" ");
  switch (pm) {
    case "pnpm":
      return `pnpm add ${pkgList}`;
    case "yarn":
      return `yarn add ${pkgList}`;
    case "bun":
      return `bun add ${pkgList}`;
    default:
      return `npm install --save ${pkgList}`;
  }
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

type InitOptions = {
  force: boolean;
  path: string;
  skipInstall: boolean;
  yes: boolean;
  interactive: boolean | undefined;
  noInteractive: boolean;
  // wizard flags
  database?: InitAnswers["database"];
  connectionEnv?: string;
  sqliteFile?: string;
  prismaSchema?: string;
  schemaOut?: string;
  aiProvider?: InitAnswers["aiProvider"];
  aiKeyEnv?: string;
  aiModelEnv?: string;
  ragStore?: InitAnswers["ragStore"];
  pgvectorEnv?: string;
  studioExecute?: boolean;
};

const VALID_DATABASES = ["postgres", "mysql", "sqlite", "sqlserver", "prisma"] as const;
const VALID_RAG_STORES = ["file", "memory", "pgvector"] as const;

function parseOptions(argv: readonly string[]): InitOptions {
  const opts: InitOptions = {
    force: false,
    path: DEFAULT_CONFIG_PATH,
    skipInstall: false,
    yes: false,
    interactive: undefined,
    noInteractive: false,
  };

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
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--interactive":
        opts.interactive = true;
        break;
      case "--no-interactive":
        opts.noInteractive = true;
        break;
      case "--studio-execute":
        opts.studioExecute = true;
        break;
      case "--no-studio-execute":
        opts.studioExecute = false;
        break;
      case "--path": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.path = value;
        break;
      }
      case "--database": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        if (!VALID_DATABASES.includes(value as InitAnswers["database"])) {
          throw new Error(`${arg}: invalid value "${value}". Allowed: ${VALID_DATABASES.join(", ")}.`);
        }
        opts.database = value as InitAnswers["database"];
        break;
      }
      case "--connection-env": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.connectionEnv = value;
        break;
      }
      case "--sqlite-file": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.sqliteFile = value;
        break;
      }
      case "--prisma-schema": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.prismaSchema = value;
        break;
      }
      case "--schema-out": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.schemaOut = value;
        break;
      }
      case "--ai-provider": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        if (!VALID_AI_PROVIDERS.includes(value as InitAnswers["aiProvider"])) {
          throw new Error(`${arg}: invalid value "${value}". Allowed: ${VALID_AI_PROVIDERS.join(", ")}.`);
        }
        opts.aiProvider = value as InitAnswers["aiProvider"];
        break;
      }
      case "--ai-key-env": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.aiKeyEnv = value;
        break;
      }
      case "--ai-model-env": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.aiModelEnv = value;
        break;
      }
      case "--rag-store": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        if (!VALID_RAG_STORES.includes(value as InitAnswers["ragStore"])) {
          throw new Error(`${arg}: invalid value "${value}". Allowed: ${VALID_RAG_STORES.join(", ")}.`);
        }
        opts.ragStore = value as InitAnswers["ragStore"];
        break;
      }
      case "--pgvector-env": {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
        opts.pgvectorEnv = value;
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

  // Conflict checks
  if (opts.yes && opts.interactive) {
    throw new Error("--yes and --interactive cannot be used together.");
  }
  if (opts.interactive && opts.noInteractive) {
    throw new Error("--interactive and --no-interactive cannot be used together.");
  }
  return opts;
}

// ---------------------------------------------------------------------------
// TTY wizard
// ---------------------------------------------------------------------------

function validatePath(value: string): true | string {
  if (!value.trim()) return "Cannot be empty.";
  return true;
}

export async function runWizard(prompter: InitPrompter): Promise<InitAnswers | null> {
  const database = await prompter.select<InitAnswers["database"]>({
    message: "Database source",
    choices: [
      { name: "PostgreSQL", value: "postgres" },
      { name: "MySQL", value: "mysql" },
      { name: "SQLite", value: "sqlite" },
      { name: "SQL Server", value: "sqlserver" },
      { name: "Prisma (schema file, no live DB)", value: "prisma" },
    ],
    default: "postgres",
  });

  // Env var NAMES are not prompted for — we use conventional defaults
  // (DATABASE_URL, OPENAI_API_KEY, ...) and tell the user afterward that
  // they can rename any of them by editing the `env("...")` calls in the
  // generated askdb.config.ts. Only real, undefaultable decisions (file
  // paths, provider choices) get a prompt.
  let connectionEnv: string | undefined;
  let sqliteFile: string | undefined;
  let prismaSchema: string | undefined;

  if (database === "sqlite") {
    sqliteFile = (
      await prompter.input({
        message: "SQLite file path",
        default: "./data.db",
        validate: validatePath,
      })
    ).trim();
  } else if (database === "prisma") {
    prismaSchema = await prompter.input({
      message: "Path to schema.prisma",
      default: "./prisma/schema.prisma",
      validate: validatePath,
    });
  } else {
    connectionEnv = "DATABASE_URL";
  }

  const schemaOut = await prompter.input({
    message: "Schema output directory",
    default: "./askdb",
    validate: validatePath,
  });

  const aiProvider = await prompter.select<InitAnswers["aiProvider"]>({
    message: "AI provider",
    choices: AI_PROVIDER_SETUPS.map((setup) => ({
      name: setup.label,
      value: setup.id as AskDbAiProviderId,
    })),
    default: "openai",
  });

  const { keyEnv: aiKeyEnv, modelEnv: aiModelEnv } = aiDefaults(aiProvider);

  const ragStore = await prompter.select<InitAnswers["ragStore"]>({
    message: "RAG store",
    choices: [
      { name: "File (default, no setup required)", value: "file" },
      { name: "Memory (fast, non-persistent)", value: "memory" },
      { name: "pgvector (Postgres vector store)", value: "pgvector" },
    ],
    default: "file",
  });

  const pgvectorEnv = ragStore === "pgvector" ? "ASKDB_PGVECTOR_URL" : undefined;

  // Opt-in: Studio execute runs generated SQL against a live database, so it
  // defaults to off (matching `--studio-execute`'s documented default).
  const enableStudioExecute = await prompter.confirm({
    message: "Enable Studio execute (run generated SQL read-only from the browser playground)?",
    default: false,
  });

  let studioExecute: InitAnswers["studioExecute"];
  if (!enableStudioExecute) {
    studioExecute = { enabled: false };
  } else if (database === "prisma") {
    // Prisma: need to choose a live provider — there's no default to fall back to.
    const execProvider = await prompter.select<"postgres" | "mysql" | "sqlite" | "sqlserver">({
      message: "Studio execute needs a live database provider. Which one?",
      choices: [
        { name: "PostgreSQL", value: "postgres" },
        { name: "MySQL", value: "mysql" },
        { name: "SQLite", value: "sqlite" },
        { name: "SQL Server", value: "sqlserver" },
      ],
      default: "postgres",
    });
    if (execProvider === "sqlite") {
      const execSqliteFile = await prompter.input({
        message: "SQLite file path for Studio execute",
        default: "./data.db",
        validate: validatePath,
      });
      studioExecute = {
        enabled: true,
        provider: "sqlite",
        sqliteFile: execSqliteFile.trim(),
      };
    } else {
      studioExecute = {
        enabled: true,
        provider: execProvider,
        connectionEnv: "DATABASE_URL",
      };
    }
  } else {
    const execProvider = database as "postgres" | "mysql" | "sqlite" | "sqlserver";
    if (execProvider === "sqlite") {
      studioExecute = {
        enabled: true,
        provider: "sqlite",
        sqliteFile: sqliteFile,
      };
    } else {
      studioExecute = {
        enabled: true,
        provider: execProvider,
        connectionEnv: connectionEnv,
      };
    }
  }

  return {
    database,
    connectionEnv,
    sqliteFile,
    prismaSchema,
    schemaOut,
    aiProvider,
    aiKeyEnv,
    aiModelEnv,
    ragStore,
    pgvectorEnv,
    studioExecute,
  };
}

// ---------------------------------------------------------------------------
// Real Inquirer prompter
// ---------------------------------------------------------------------------

async function buildInquirerPrompter(): Promise<InitPrompter> {
  const { select, input, confirm } = await import("@inquirer/prompts");
  return {
    select: (opts) => select({ message: opts.message, choices: opts.choices, default: opts.default }),
    input: (opts) => input({ message: opts.message, default: opts.default, validate: opts.validate }),
    confirm: (opts) => confirm({ message: opts.message, default: opts.default }),
  };
}

// ---------------------------------------------------------------------------
// Next steps printer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// .env.example generation
// ---------------------------------------------------------------------------

const DB_URL_PLACEHOLDER: Partial<Record<InitAnswers["database"], string>> = {
  postgres: "postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
  mysql: "mysql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>",
  sqlserver:
    "Data Source=<DATABASE_HOST>,<DATABASE_PORT>;Initial Catalog=<DATABASE_NAME>;User ID=<USERNAME>;Password=<PASSWORD>;Trust Server Certificate=True;Authentication=SqlPassword;",
};

function buildEnvExample(answers: InitAnswers): string {
  const lines: string[] = [
    "# AskDB environment — copy to .env and fill in real values.",
    "# .env is read by the CLI, Studio, and the HTTP API; never commit it.",
    "",
  ];

  const needsConnectionEnv = answers.database !== "sqlite" && answers.database !== "prisma";
  if (needsConnectionEnv && answers.connectionEnv) {
    const placeholder = DB_URL_PLACEHOLDER[answers.database];
    lines.push(placeholder ? `${answers.connectionEnv}=${placeholder}` : `${answers.connectionEnv}=`);
  }

  if (answers.ragStore === "pgvector" && answers.pgvectorEnv) {
    lines.push(`${answers.pgvectorEnv}=postgresql://<USERNAME>:<PASSWORD>@<DATABASE_HOST>:<DATABASE_PORT>/<DATABASE_NAME>`);
  }

  // Only emit a separate execute URL if it differs from the introspection URL
  if (
    answers.studioExecute.enabled &&
    answers.studioExecute.provider !== "sqlite" &&
    answers.studioExecute.connectionEnv &&
    answers.studioExecute.connectionEnv !== answers.connectionEnv
  ) {
    const placeholder = DB_URL_PLACEHOLDER[answers.studioExecute.provider];
    lines.push(placeholder
      ? `${answers.studioExecute.connectionEnv}=${placeholder}`
      : `${answers.studioExecute.connectionEnv}=`);
  }

  lines.push(`${answers.aiKeyEnv}=`);
  if (answers.aiModelEnv) lines.push(`${answers.aiModelEnv}=`);
  const resourceEnv = azureResourceEnv(answers);
  if (resourceEnv) {
    lines.push(`# Subdomain of your endpoint, e.g. "my-resource" for https://my-resource.openai.azure.com`);
    lines.push(`${resourceEnv}=`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Env var NAMES the generated config references — conventional defaults, not values. */
function collectEnvVarNames(answers: InitAnswers): string[] {
  const names = new Set<string>();
  names.add(answers.aiKeyEnv);
  if (answers.aiModelEnv) names.add(answers.aiModelEnv);
  const resourceEnv = azureResourceEnv(answers);
  if (resourceEnv) names.add(resourceEnv);
  const isEnvName = (v: string) => !v.startsWith("./") && !v.startsWith("/");
  if (answers.database !== "sqlite" && answers.database !== "prisma" && answers.connectionEnv) {
    names.add(answers.connectionEnv);
  } else if (answers.database === "sqlite" && answers.sqliteFile && isEnvName(answers.sqliteFile)) {
    names.add(answers.sqliteFile);
  }
  if (answers.ragStore === "pgvector" && answers.pgvectorEnv) names.add(answers.pgvectorEnv);
  if (answers.studioExecute.enabled) {
    if (answers.studioExecute.provider === "sqlite") {
      const f = answers.studioExecute.sqliteFile;
      if (f && isEnvName(f)) names.add(f);
    } else if (answers.studioExecute.connectionEnv) {
      names.add(answers.studioExecute.connectionEnv);
    }
  }
  return Array.from(names);
}

function printNextSteps(answers: InitAnswers): void {
  const lines = ["\nNext steps:"];
  lines.push("  1. Copy .env.example → .env and fill in your credentials.");
  lines.push(
    "     (Rename any `env(\"...\")` call in askdb.config.ts if you prefer different variable names.)",
  );
  if (answers.database !== "prisma") {
    lines.push("  2. Introspect your database:  askdb introspect");
  } else {
    lines.push("  2. Introspect your Prisma schema:  askdb introspect");
  }
  if (answers.studioExecute.enabled) {
    lines.push("  3. Open Studio:  askdb studio");
  }
  lines.push(`  ${answers.studioExecute.enabled ? "4" : "3"}. Ask a question:  askdb ask --question "Which customers signed up last week?"`);
  process.stdout.write(lines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInitCli(
  argv: readonly string[],
  _installer?: InstallFn,
): Promise<number> {
  const installer = _installer ?? defaultInstaller;

  let opts: InitOptions;
  try {
    opts = parseOptions(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    return 1;
  }

  if (opts.path === "--help") {
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

  // Determine interactive mode
  const isTTY = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  const wantInteractive = opts.interactive === true || (!opts.yes && !opts.noInteractive && isTTY);

  if (opts.interactive && !isTTY) {
    process.stderr.write("--interactive requires stdin and stdout to be TTYs.\n");
    return 1;
  }

  let answers: InitAnswers;

  if (wantInteractive) {
    let prompter: InitPrompter;
    try {
      prompter = await buildInquirerPrompter();
    } catch {
      process.stderr.write("Failed to load @inquirer/prompts. Falling back to non-interactive mode.\n");
      answers = resolveDefaultInitAnswers(optsToOverrides(opts));
      return await finishInit(configTarget, answers, opts, installer);
    }

    let wizardResult: InitAnswers | null;
    try {
      wizardResult = await runWizard(prompter);
    } catch {
      process.stderr.write("\nSetup cancelled.\n");
      return 1;
    }

    if (!wizardResult) {
      process.stderr.write("\nSetup cancelled.\n");
      return 1;
    }

    answers = wizardResult;

    // Summary and confirmation
    const specs = resolveInitDepSpecs();
    const plan = buildInitInstallPlan(answers, specs);
    process.stdout.write("\n--- Summary ---\n");
    process.stdout.write(`  Config path:   ${configTarget}\n`);
    process.stdout.write(`  Database:      ${answers.database}\n`);
    process.stdout.write(`  AI provider:   ${answers.aiProvider}\n`);
    process.stdout.write(`  RAG store:     ${answers.ragStore}\n`);
    process.stdout.write(`  Studio execute: ${answers.studioExecute.enabled ? `enabled (${answers.studioExecute.provider})` : "disabled"}\n`);
    if (!opts.skipInstall) {
      process.stdout.write(`  Packages:      ${plan.labels.join(", ")}\n`);
    }
    process.stdout.write(`  Env vars:      ${collectEnvVarNames(answers).join(", ")}\n`);
    process.stdout.write('                 (defaults — rename via `env("...")` in askdb.config.ts if you\'d like)\n');
    process.stdout.write("---------------\n\n");

    let confirmed: boolean;
    try {
      confirmed = await prompter.confirm({ message: "Write config and install packages?", default: true });
    } catch {
      process.stderr.write("\nSetup cancelled.\n");
      return 1;
    }

    if (!confirmed) {
      process.stdout.write("Cancelled. No files written.\n");
      return 1;
    }
  } else {
    answers = resolveDefaultInitAnswers(optsToOverrides(opts));
  }

  return await finishInit(configTarget, answers, opts, installer);
}

function optsToOverrides(opts: InitOptions): InitAnswerOverrides {
  return {
    database: opts.database,
    connectionEnv: opts.connectionEnv,
    sqliteFile: opts.sqliteFile,
    prismaSchema: opts.prismaSchema,
    schemaOut: opts.schemaOut,
    aiProvider: opts.aiProvider,
    aiKeyEnv: opts.aiKeyEnv,
    aiModelEnv: opts.aiModelEnv,
    ragStore: opts.ragStore,
    pgvectorEnv: opts.pgvectorEnv,
    studioExecute: opts.studioExecute,
  };
}

async function finishInit(
  configTarget: string,
  answers: InitAnswers,
  opts: InitOptions,
  installer: InstallFn,
): Promise<number> {
  const configContent = renderInitConfig(answers);

  try {
    writeFileSync(configTarget, configContent, { encoding: "utf8" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Failed to write config: ${msg}\n`);
    return 1;
  }

  process.stdout.write(`Wrote:\n  - ${configTarget}\n`);

  const envExamplePath = join(dirname(configTarget), ".env.example");
  if (!existsSync(envExamplePath)) {
    try {
      writeFileSync(envExamplePath, buildEnvExample(answers), { encoding: "utf8" });
      process.stdout.write(`  - ${envExamplePath}\n`);
    } catch {
      // non-fatal — config was written successfully
    }
  }

  if (!opts.skipInstall) {
    const pkgRoot = findNearestPackageJsonDir(process.cwd());
    const specs = resolveInitDepSpecs();
    const plan = buildInitInstallPlan(answers, specs);

    if (!pkgRoot) {
      process.stdout.write(
        "\nNo package.json found in this directory or any parent directory.\n" +
          "Install the template imports yourself (from a project with a package.json):\n" +
          `  npm install --save ${plan.packages.join(" ")}\n\n`,
      );
    } else if (isLikelyWorkspaceRoot(pkgRoot)) {
      process.stdout.write(
        "\nSkipped automatic dependency install (workspace / monorepo root).\n" +
          "Add these to the package that will load this config (or run `askdb init` from that package directory):\n" +
          `  npm install --save ${plan.packages.join(" ")}\n\n`,
      );
    } else {
      const pm = detectPackageManager(pkgRoot);
      process.stdout.write(`\nInstalling dependencies with ${pm} in ${pkgRoot} …\n`);
      const ok = installer(pm, pkgRoot, plan.packages);
      if (!ok) {
        process.stderr.write(
          "Dependency install failed. The config file was written, but packages are not installed yet.\n" +
            `  cd ${pkgRoot}\n` +
            `  ${formatManualInstallCommand(pm, plan.packages)}\n`,
        );
        return 1;
      }
      process.stdout.write(`Installed: ${plan.labels.join(", ")}.\n`);
    }
  }

  printNextSteps(answers);
  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      "askdb init - Create askdb.config.ts tailored to your database and AI provider",
      "",
      "Usage:",
      "  askdb init                    Start wizard in a TTY, or use defaults in CI",
      "  askdb init --yes              Accept defaults without prompts",
      "  askdb init --no-interactive   Same as --yes",
      "  askdb init --force            Overwrite an existing askdb.config.ts",
      "  askdb init --path <file>      Write config to a custom file path",
      "  askdb init --skip-install     Only write the file; do not install packages",
      "",
      "Database options:",
      "  --database <db>               postgres|mysql|sqlite|sqlserver|prisma (default: postgres)",
      "  --connection-env <name>       Env var name for connection URL",
      "  --sqlite-file <path-or-env>   SQLite file path or env var name",
      "  --prisma-schema <path>        Path to schema.prisma",
      "  --schema-out <dir>            Schema output directory (default: ./askdb)",
      "",
      "AI options:",
      `  --ai-provider <name>          ${VALID_AI_PROVIDERS.join("|")} (default: openai)`,
      "  --ai-key-env <name>           Env var name for API key",
      "  --ai-model-env <name>         Env var name for model override",
      "",
      "RAG options:",
      "  --rag-store <name>            file|memory|pgvector (default: file)",
      "  --pgvector-env <name>         Env var name for pgvector URL",
      "",
      "Studio options:",
      "  --studio-execute              Enable Studio execute (default: off)",
      "  --no-studio-execute           Disable Studio execute",
      "",
    ].join("\n"),
  );
}
