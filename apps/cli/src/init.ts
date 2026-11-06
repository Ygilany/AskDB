import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBuiltinAiProviderSetup, listBuiltinAiProviderSetups } from "@askdb/ai";
import { ASKDB_AI_PROVIDERS, type AskDbAiProviderId } from "@askdb/config";
import {
  AskDbScaffoldInputError,
  detectPackageManager,
  findNearestPackageJsonDir,
  formatInstallCommand,
  isLikelyWorkspaceRoot,
  packageManagerAddArgs,
  packageManagerSpawnSpec,
  planAskDbScaffold,
  supportedBuildApprovals,
  type AskDbScaffoldAnswers,
  type AskDbScaffoldPlan,
  type PackageManager,
  type ScaffoldValue,
} from "@askdb/config/scaffold";
import { runCommand, type CommandSpec, type Flag } from "./command.js";
import { showable } from "./error-values.js";

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
// The scaffold plan
// ---------------------------------------------------------------------------

/**
 * Selectable AI providers, in `@askdb/ai`'s built-in table order: every id that has an
 * `askdb.config.*` branch (`ASKDB_AI_PROVIDERS`), with the key/model env var names to
 * scaffold. Derived from `@askdb/ai`'s `BUILTIN_AI_PROVIDERS` so it cannot drift.
 */
const AI_PROVIDER_SETUPS = listBuiltinAiProviderSetups(ASKDB_AI_PROVIDERS);
/** Every id `--ai-provider` accepts; its help line lists them. */
export const VALID_AI_PROVIDERS = AI_PROVIDER_SETUPS.map((setup) => setup.id as AskDbAiProviderId);

function aiDefaults(provider: AskDbAiProviderId): { keyEnv: string; modelEnv: string } {
  const setup = getBuiltinAiProviderSetup(provider);
  if (!setup) throw new Error(`askdb init: "${provider}" is not a built-in AI provider.`);
  return setup;
}

/**
 * `--sqlite-file`'s value as the config reads it: an env-var-shaped value (`SQLITE_FILE`,
 * `UPPER_SNAKE_CASE`) is a variable, anything else (`data.db`, `../db/app.db`, `/srv/app.db`)
 * a path. No value means the `SQLITE_FILE` variable.
 */
function sqliteFileValue(file: string | undefined): ScaffoldValue {
  if (!file) return { env: "SQLITE_FILE" };
  return /^[A-Z_][A-Z0-9_]*$/.test(file) ? { env: file } : { path: file };
}

/** `InitAnswers` as the planner in `@askdb/config/scaffold` takes them. It ignores what the engine doesn't read. */
function scaffoldAnswers(answers: InitAnswers): AskDbScaffoldAnswers {
  const { studioExecute } = answers;
  return {
    database: answers.database,
    connectionEnv: answers.connectionEnv ?? "DATABASE_URL",
    sqliteFile: sqliteFileValue(answers.sqliteFile),
    ...(answers.prismaSchema ? { prismaSchemaPath: answers.prismaSchema } : {}),
    schemaOut: answers.schemaOut,
    ai: {
      provider: answers.aiProvider,
      keyEnv: answers.aiKeyEnv,
      ...(answers.aiModelEnv ? { modelEnv: answers.aiModelEnv } : {}),
    },
    rag: { store: answers.ragStore, pgvectorEnv: answers.pgvectorEnv ?? "ASKDB_PGVECTOR_URL" },
    ...(studioExecute.enabled
      ? {
          studioExecute: {
            provider: studioExecute.provider,
            connectionEnv: studioExecute.connectionEnv ?? "DATABASE_URL",
            sqliteFile: sqliteFileValue(studioExecute.sqliteFile),
          },
        }
      : {}),
  };
}

/** The flag that sets each planner answer, for errors. */
const ANSWER_FLAGS: Record<string, string> = {
  database: "--database",
  connectionEnv: "--connection-env",
  sqliteFile: "--sqlite-file",
  prismaSchemaPath: "--prisma-schema",
  schemaOut: "--schema-out",
  "ai.provider": "--ai-provider",
  "ai.keyEnv": "--ai-key-env",
  "ai.modelEnv": "--ai-model-env",
  "rag.store": "--rag-store",
  "rag.pgvectorEnv": "--pgvector-env",
  "studioExecute.sqliteFile": "--sqlite-file",
};

/**
 * The config, `.env.example` and installs for `answers`, from `@askdb/config/scaffold`'s
 * planner (shared with Studio's setup wizard). A bad answer fails with an error that names
 * its flag, before anything is written.
 */
export function planInitScaffold(answers: InitAnswers, specs: InitDepSpecs): AskDbScaffoldPlan {
  try {
    return planAskDbScaffold(scaffoldAnswers(answers), { config: specs.configSpec, prisma: specs.prismaSpec });
  } catch (error) {
    if (!(error instanceof AskDbScaffoldInputError)) throw error;
    throw new Error(`${ANSWER_FLAGS[error.field] ?? error.field} ${error.reason}`);
  }
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
// Dependency versions
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

export type InitDepSpecs = { configSpec: string; prismaSpec: string };

/**
 * The versions `askdb init` installs: `@askdb/config` and `@askdb/prisma` at the versions
 * this CLI was built with. Published, those are its `@askdb/config` dependency and the floor
 * of its `@askdb/prisma` peer range (`^x` → `x`); in the monorepo, the workspace packages'.
 */
export function resolveInitDepSpecs(): InitDepSpecs {
  const cliPkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    configSpec: builtWithVersion("@askdb/config", cliPkg.dependencies?.["@askdb/config"]),
    prismaSpec: builtWithVersion("@askdb/prisma", cliPkg.peerDependencies?.["@askdb/prisma"]),
  };
}

function builtWithVersion(packageName: string, declared: string | undefined): string {
  if (!declared) return "latest";
  if (!declared.startsWith("workspace:")) return declared.replace(/^[\^~]/, "");
  try {
    // Resolve the entry point and walk up: `exports` may not expose `./package.json`.
    const pkgDir = findNearestPackageJsonDir(dirname(require.resolve(packageName)));
    const v = pkgDir ? (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { version?: string }) : {};
    return v.version ?? "latest";
  } catch {
    return "latest";
  }
}

// ---------------------------------------------------------------------------
// Package manager install
// ---------------------------------------------------------------------------

/** Runs the package manager's add command; `allowBuilds` are the pnpm build approvals it passes. */
type InstallFn = (pm: PackageManager, packageDir: string, packages: string[], allowBuilds: string[]) => boolean;

function defaultInstaller(pm: PackageManager, packageDir: string, packages: string[], allowBuilds: string[]): boolean {
  const env = { ...process.env, CI: process.env.CI ?? "true" };
  const { command, args, shell } = packageManagerSpawnSpec(pm, packageManagerAddArgs(pm, packages, allowBuilds));
  const r = spawnSync(command, args, { cwd: packageDir, stdio: "inherit", env, shell });
  return r.status === 0;
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

/** A flag that takes one of `allowed`; the error repeats a bad value only when it's `showable`. */
function oneOf<T extends string>(flag: string, allowed: readonly T[], value: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  const got = showable(value) ? ` "${value}"` : "";
  throw new Error(`${flag}: invalid value${got}. Allowed: ${allowed.join(", ")}.`);
}

/** Every flag `askdb init` accepts, for the parser and the help. */
const INIT_FLAGS: readonly Flag<InitOptions>[] = [
  { names: ["-y", "--yes"], help: "Accept defaults without prompts.", apply: (opts) => (opts.yes = true) },
  {
    names: ["--interactive"],
    help: "Force wizard mode; errors if stdin/stdout are not TTYs.",
    apply: (opts) => (opts.interactive = true),
  },
  { names: ["--no-interactive"], help: "Never prompt; use defaults or flags.", apply: (opts) => (opts.noInteractive = true) },
  {
    names: ["--path"],
    value: "<file>",
    help: `Write the config to this path. Default: ${DEFAULT_CONFIG_PATH}.`,
    apply: (opts, value) => (opts.path = value),
  },
  { names: ["-f", "--force"], help: "Overwrite an existing file.", apply: (opts) => (opts.force = true) },
  {
    names: ["--skip-install"],
    help: "Only write the file; do not install packages.",
    apply: (opts) => (opts.skipInstall = true),
  },
  {
    names: ["--database"],
    value: "<db>",
    group: "Database options",
    help: `${VALID_DATABASES.join("|")} (default: postgres)`,
    apply: (opts, value) => (opts.database = oneOf("--database", VALID_DATABASES, value)),
  },
  {
    names: ["--connection-env"],
    value: "<name>",
    group: "Database options",
    help: "Env var name for connection URL",
    apply: (opts, value) => (opts.connectionEnv = value),
  },
  {
    names: ["--sqlite-file"],
    value: "<path-or-env>",
    group: "Database options",
    help: "SQLite file path, or an UPPER_SNAKE_CASE env var name",
    apply: (opts, value) => (opts.sqliteFile = value),
  },
  {
    names: ["--prisma-schema"],
    value: "<path>",
    group: "Database options",
    help: "Path to schema.prisma",
    apply: (opts, value) => (opts.prismaSchema = value),
  },
  {
    names: ["--schema-out"],
    value: "<dir>",
    group: "Database options",
    help: "Schema output directory (default: ./askdb)",
    apply: (opts, value) => (opts.schemaOut = value),
  },
  {
    names: ["--ai-provider"],
    value: "<name>",
    group: "AI options",
    help: `${VALID_AI_PROVIDERS.join("|")} (default: openai)`,
    apply: (opts, value) => (opts.aiProvider = oneOf("--ai-provider", VALID_AI_PROVIDERS, value)),
  },
  {
    names: ["--ai-key-env"],
    value: "<name>",
    group: "AI options",
    help: "Env var name for API key",
    apply: (opts, value) => (opts.aiKeyEnv = value),
  },
  {
    names: ["--ai-model-env"],
    value: "<name>",
    group: "AI options",
    help: "Env var name for model override",
    apply: (opts, value) => (opts.aiModelEnv = value),
  },
  {
    names: ["--rag-store"],
    value: "<name>",
    group: "RAG options",
    help: `${VALID_RAG_STORES.join("|")} (default: file)`,
    apply: (opts, value) => (opts.ragStore = oneOf("--rag-store", VALID_RAG_STORES, value)),
  },
  {
    names: ["--pgvector-env"],
    value: "<name>",
    group: "RAG options",
    help: "Env var name for pgvector URL",
    apply: (opts, value) => (opts.pgvectorEnv = value),
  },
  {
    names: ["--studio-execute"],
    group: "Studio options",
    help: "Enable Studio execute (default: off)",
    apply: (opts) => (opts.studioExecute = true),
  },
  {
    names: ["--no-studio-execute"],
    group: "Studio options",
    help: "Disable Studio execute",
    apply: (opts) => (opts.studioExecute = false),
  },
];

/** `askdb init`, installing packages with `installer`. It never reads askdb.config. */
export function initCommand(installer: InstallFn = defaultInstaller): CommandSpec<InitOptions> {
  return {
    name: "init",
    summary: "Create askdb.config.ts tailored to your database and AI provider",
    usage: [
      "askdb init                    Start wizard in a TTY, or use defaults in CI",
      "askdb init --yes              Accept defaults without prompts",
      "askdb init --no-interactive   Same as --yes",
      "askdb init --force            Overwrite an existing askdb.config.ts",
      "askdb init --path <file>      Write config to a custom file path",
      "askdb init --skip-install     Only write the file; do not install packages",
    ],
    flags: INIT_FLAGS,
    initial: () => ({
      force: false,
      path: DEFAULT_CONFIG_PATH,
      skipInstall: false,
      yes: false,
      interactive: undefined,
      noInteractive: false,
    }),
    check(opts) {
      if (opts.yes && opts.interactive) {
        throw new Error("--yes and --interactive cannot be used together.");
      }
      if (opts.interactive && opts.noInteractive) {
        throw new Error("--interactive and --no-interactive cannot be used together.");
      }
    },
    needsConfig: () => false,
    run: (opts) => runInit(opts, installer),
  };
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

export async function runInitCli(argv: readonly string[], installer?: InstallFn): Promise<number> {
  return runCommand(initCommand(installer), argv);
}

async function runInit(opts: InitOptions, installer: InstallFn): Promise<number> {
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
  let plan: AskDbScaffoldPlan;

  if (wantInteractive) {
    let prompter: InitPrompter;
    try {
      prompter = await buildInquirerPrompter();
    } catch {
      process.stderr.write("Failed to load @inquirer/prompts. Falling back to non-interactive mode.\n");
      answers = resolveDefaultInitAnswers(optsToOverrides(opts));
      return await finishInit(configTarget, answers, planInitScaffold(answers, resolveInitDepSpecs()), opts, installer);
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
    plan = planInitScaffold(answers, resolveInitDepSpecs());

    // Summary and confirmation
    process.stdout.write("\n--- Summary ---\n");
    process.stdout.write(`  Config path:   ${configTarget}\n`);
    process.stdout.write(`  Database:      ${answers.database}\n`);
    process.stdout.write(`  AI provider:   ${answers.aiProvider}\n`);
    process.stdout.write(`  RAG store:     ${answers.ragStore}\n`);
    process.stdout.write(`  Studio execute: ${answers.studioExecute.enabled ? `enabled (${answers.studioExecute.provider})` : "disabled"}\n`);
    if (!opts.skipInstall) {
      const packages = packagesToInstall(plan, findNearestPackageJsonDir(process.cwd()));
      process.stdout.write(`  Packages:      ${packages.map(packageNameOf).join(", ")}\n`);
    }
    process.stdout.write(`  Env vars:      ${plan.envVars.map((v) => v.name).join(", ")}\n`);
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
    plan = planInitScaffold(answers, resolveInitDepSpecs());
  }

  return await finishInit(configTarget, answers, plan, opts, installer);
}

/** `@askdb/prisma` from `@askdb/prisma@1.0.0`, `pg` from `pg`. */
function packageNameOf(spec: string): string {
  const at = spec.indexOf("@", 1);
  return at === -1 ? spec : spec.slice(0, at);
}

/**
 * The plan's packages to install in `pkgRoot`. AskDB's own packages always install, at the
 * versions this CLI pins. Any other package (a driver, or `ai` and `zod` for Prisma) installs
 * only when the project's `package.json` doesn't list it yet, so `init` never moves a range
 * the project already chose, such as `ai@^6`. With no project, or at a workspace root, where
 * `init` only prints the command for another package, every package is listed.
 */
function packagesToInstall(plan: AskDbScaffoldPlan, pkgRoot: string | undefined): string[] {
  const listed = pkgRoot && !isLikelyWorkspaceRoot(pkgRoot) ? listedDependencies(pkgRoot) : new Set<string>();
  return plan.install.packages.filter((spec) => {
    const name = packageNameOf(spec);
    return name.startsWith("@askdb/") || !listed.has(name);
  });
}

/** Every package `dir/package.json` lists as a dependency of any kind. */
function listedDependencies(dir: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    return new Set(
      fields.flatMap((field) => {
        const deps = pkg[field];
        return deps !== null && typeof deps === "object" ? Object.keys(deps) : [];
      }),
    );
  } catch {
    return new Set();
  }
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
  plan: AskDbScaffoldPlan,
  opts: InitOptions,
  installer: InstallFn,
): Promise<number> {
  try {
    writeFileSync(configTarget, plan.configSource, { encoding: "utf8" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Failed to write config: ${msg}\n`);
    return 1;
  }

  process.stdout.write(`Wrote:\n  - ${configTarget}\n`);

  const envExamplePath = join(dirname(configTarget), ".env.example");
  if (!existsSync(envExamplePath)) {
    try {
      writeFileSync(envExamplePath, plan.envExample, { encoding: "utf8" });
      process.stdout.write(`  - ${envExamplePath}\n`);
    } catch {
      // non-fatal — config was written successfully
    }
  }

  if (!opts.skipInstall) {
    const pkgRoot = findNearestPackageJsonDir(process.cwd());
    const packages = packagesToInstall(plan, pkgRoot);
    const { allowBuilds } = plan.install;

    // The manager comes from the project's lockfile or package.json, else from whoever
    // ran init (`pnpm dlx`, `npx`, …); with no package.json, from the current directory.
    const pmDir = pkgRoot ?? process.cwd();
    const pm = detectPackageManager(pmDir);
    const approvedBuilds = supportedBuildApprovals(pm, pmDir, allowBuilds);
    const installCommand = formatInstallCommand(pm, packages, approvedBuilds);

    if (!pkgRoot) {
      process.stdout.write(
        "\nNo package.json found in this directory or any parent directory.\n" +
          "Install the template imports yourself (from a project with a package.json):\n" +
          `  ${installCommand}\n\n`,
      );
    } else if (isLikelyWorkspaceRoot(pkgRoot)) {
      process.stdout.write(
        "\nSkipped automatic dependency install (workspace / monorepo root).\n" +
          "Add these to the package that will load this config (or run `askdb init` from that package directory):\n" +
          `  ${installCommand}\n\n`,
      );
    } else {
      process.stdout.write(`\nInstalling dependencies with ${pm} in ${pkgRoot} …\n`);
      const ok = installer(pm, pkgRoot, packages, approvedBuilds);
      if (!ok) {
        process.stderr.write(
          "Dependency install failed. The config file was written, but packages are not installed yet.\n" +
            `  cd ${pkgRoot}\n` +
            `  ${installCommand}\n`,
        );
        return 1;
      }
      process.stdout.write(`Installed: ${packages.map(packageNameOf).join(", ")}.\n`);
    }
  }

  printNextSteps(answers);
  return 0;
}
