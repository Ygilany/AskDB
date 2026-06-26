import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  aiProvider: "openai" | "anthropic" | "google" | "azure" | "foundry";
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

/** AI provider defaults for key/model env vars */
const AI_DEFAULTS: Record<
  InitAnswers["aiProvider"],
  { keyEnv: string; modelEnv: string; modelField: string }
> = {
  openai: { keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", modelField: "model" },
  anthropic: { keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", modelField: "model" },
  google: { keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", modelEnv: "GOOGLE_GENERATIVE_AI_MODEL", modelField: "model" },
  azure: { keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT", modelField: "model" },
  foundry: { keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT", modelField: "model" },
};

function renderAiSection(answers: InitAnswers): string {
  const { aiProvider, aiKeyEnv, aiModelEnv } = answers;
  const modelLine = aiModelEnv ? `\n        ${AI_DEFAULTS[aiProvider].modelField}: env("${aiModelEnv}"),` : "";
  return `  ai: {
    provider: "${aiProvider}",
    providerConfig: {
      ${aiProvider}: {
        apiKey: env("${aiKeyEnv}"),${modelLine}
      },
    },
  },`;
}

function renderIntrospectionSection(answers: InitAnswers): string {
  const { database, connectionEnv, sqliteFile, prismaSchema, schemaOut } = answers;
  const outputDirLine = `\n    outputDir: "${schemaOut}",`;
  switch (database) {
    case "postgres":
      return `  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: {
        databaseUrl: env("${connectionEnv ?? "DATABASE_URL"}"),
      },
    },${outputDirLine}
  },`;
    case "mysql":
      return `  introspection: {
    provider: "mysql",
    providerConfig: {
      mysql: {
        databaseUrl: env("${connectionEnv ?? "DATABASE_URL"}"),
      },
    },${outputDirLine}
  },`;
    case "sqlite": {
      const fileExpr = sqliteFile && !sqliteFile.startsWith("./") && !sqliteFile.startsWith("/")
        ? `env("${sqliteFile}")`
        : `env("SQLITE_FILE")`;
      const resolvedFile = sqliteFile && (sqliteFile.startsWith("./") || sqliteFile.startsWith("/"))
        ? `"${sqliteFile}"`
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
        databaseUrl: env("${connectionEnv ?? "SQLSERVER_URL"}"),
      },
    },${outputDirLine}
  },`;
    case "prisma": {
      const schemaLine = prismaSchema ? `\n        schemaPath: "${prismaSchema}",` : "";
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
        databaseUrl: env("${pgvectorEnv ?? "ASKDB_PGVECTOR_URL"}"),
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
      ? `"${studioExecute.sqliteFile}"`
      : `env("${studioExecute.sqliteFile ?? "SQLITE_FILE"}")`;
    return `  studio: {
    execute: {
      provider: "sqlite",
      file: ${fileExpr},
    },
  },`;
  }

  const urlEnv = studioExecute.connectionEnv ?? (provider === "sqlserver" ? "SQLSERVER_URL" : "DATABASE_URL");
  return `  studio: {
    execute: {
      provider: "${provider}",
      databaseUrl: env("${urlEnv}"),
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

  return `import dotenv from "dotenv";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

dotenv.config({ quiet: true });

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
  const aiDefaults = AI_DEFAULTS[aiProvider];

  let connectionEnv = overrides.connectionEnv;
  if (!connectionEnv) {
    if (database === "sqlserver") connectionEnv = "SQLSERVER_URL";
    else if (database === "sqlite") connectionEnv = undefined;
    else connectionEnv = "DATABASE_URL";
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
      connectionEnv: overrides.studioExecuteConnectionEnv ?? (execProvider === "sqlite" ? undefined : (execProvider === "sqlserver" ? "SQLSERVER_URL" : "DATABASE_URL")),
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
    aiKeyEnv: overrides.aiKeyEnv ?? aiDefaults.keyEnv,
    aiModelEnv: overrides.aiModelEnv ?? aiDefaults.modelEnv,
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

export type InitDepSpecs = { configSpec: string; dotenvSpec: string };

export function buildInitInstallPlan(answers: InitAnswers, specs: InitDepSpecs): InitInstallPlan {
  const packages: string[] = [
    `@askdb/config@${specs.configSpec}`,
    `dotenv@${specs.dotenvSpec}`,
  ];
  const labels: string[] = ["@askdb/config", "dotenv"];

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
  let dotenvSpec = "^17.4.2";
  try {
    const cfgPkgPath = require.resolve("@askdb/config/package.json");
    const cfg = JSON.parse(readFileSync(cfgPkgPath, "utf8")) as { dependencies?: { dotenv?: string } };
    if (cfg.dependencies?.dotenv) dotenvSpec = cfg.dependencies.dotenv;
  } catch {
    // keep default
  }
  return { configSpec, dotenvSpec };
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
const VALID_AI_PROVIDERS = ["openai", "anthropic", "google", "azure", "foundry"] as const;
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

const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]*$/i;

function validateEnvVar(value: string): true | string {
  if (!value.trim()) return "Cannot be empty.";
  if (!ENV_VAR_RE.test(value.trim())) return "Use only letters, digits, and underscores (e.g. DATABASE_URL).";
  return true;
}

function validatePath(value: string): true | string {
  if (!value.trim()) return "Cannot be empty.";
  return true;
}

async function runWizard(prompter: InitPrompter): Promise<InitAnswers | null> {
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

  let connectionEnv: string | undefined;
  let sqliteFile: string | undefined;
  let prismaSchema: string | undefined;

  if (database === "sqlite") {
    const raw = await prompter.input({
      message: "SQLite file path or env var name (e.g. ./data/app.db or SQLITE_FILE)",
      default: "SQLITE_FILE",
    });
    const trimmed = raw.trim();
    if (trimmed.startsWith("./") || trimmed.startsWith("/")) {
      sqliteFile = trimmed;
    } else {
      sqliteFile = trimmed;
    }
  } else if (database === "prisma") {
    prismaSchema = await prompter.input({
      message: "Path to schema.prisma",
      default: "./prisma/schema.prisma",
      validate: validatePath,
    });
  } else {
    const defaultEnv = database === "sqlserver" ? "SQLSERVER_URL" : "DATABASE_URL";
    connectionEnv = await prompter.input({
      message: `Env var name for connection URL`,
      default: defaultEnv,
      validate: validateEnvVar,
    });
  }

  const schemaOut = await prompter.input({
    message: "Schema output directory",
    default: "./askdb",
    validate: validatePath,
  });

  const aiProvider = await prompter.select<InitAnswers["aiProvider"]>({
    message: "AI provider",
    choices: [
      { name: "OpenAI", value: "openai" },
      { name: "Anthropic", value: "anthropic" },
      { name: "Google (Gemini)", value: "google" },
      { name: "Azure OpenAI", value: "azure" },
      { name: "Azure AI Foundry", value: "foundry" },
    ],
    default: "openai",
  });

  const aiKeyEnv = await prompter.input({
    message: `Env var for ${aiProvider} API key`,
    default: AI_DEFAULTS[aiProvider].keyEnv,
    validate: validateEnvVar,
  });

  const aiModelEnv = await prompter.input({
    message: `Env var for ${aiProvider} model (leave blank to use provider default)`,
    default: AI_DEFAULTS[aiProvider].modelEnv,
  });

  const ragStore = await prompter.select<InitAnswers["ragStore"]>({
    message: "RAG store",
    choices: [
      { name: "File (default, no setup required)", value: "file" },
      { name: "Memory (fast, non-persistent)", value: "memory" },
      { name: "pgvector (Postgres vector store)", value: "pgvector" },
    ],
    default: "file",
  });

  let pgvectorEnv: string | undefined;
  if (ragStore === "pgvector") {
    pgvectorEnv = await prompter.input({
      message: "Env var for pgvector connection URL",
      default: "ASKDB_PGVECTOR_URL",
      validate: validateEnvVar,
    });
  }

  const studioExecuteDefault = database !== "prisma";
  const enableStudioExecute = await prompter.confirm({
    message: "Enable Studio execute (run queries from the browser playground)?",
    default: studioExecuteDefault,
  });

  let studioExecute: InitAnswers["studioExecute"];
  if (!enableStudioExecute) {
    studioExecute = { enabled: false };
  } else if (database === "prisma") {
    // Prisma: need to choose a live provider
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
        message: "SQLite file path or env var name for Studio execute",
        default: "SQLITE_FILE",
      });
      studioExecute = {
        enabled: true,
        provider: "sqlite",
        sqliteFile: execSqliteFile.trim(),
      };
    } else {
      const execEnv = execProvider === "sqlserver" ? "SQLSERVER_URL" : "DATABASE_URL";
      const execConnEnv = await prompter.input({
        message: `Env var for Studio execute connection URL`,
        default: execEnv,
        validate: validateEnvVar,
      });
      studioExecute = {
        enabled: true,
        provider: execProvider,
        connectionEnv: execConnEnv,
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
    aiModelEnv: aiModelEnv.trim() || undefined,
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

function printNextSteps(answers: InitAnswers): void {
  const lines = ["\nNext steps:"];
  lines.push("  1. Set env vars to match the `env(\"...\")` calls in askdb.config.ts.");
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
      "  --ai-provider <name>          openai|anthropic|google|azure|foundry (default: openai)",
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
