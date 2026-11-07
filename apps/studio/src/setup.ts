import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, join, resolve, isAbsolute, relative } from "node:path";
import { getBuiltinAiProviderSetup } from "@askdb/ai";
import {
  ASKDB_AI_PROVIDERS,
  ASKDB_STUDIO_EXECUTE_PROVIDERS,
  bootstrapAskDbEnv,
  discoverAskDbConfigPath,
  getAskDbRuntimeConfig,
  type AskDbAiProviderId,
} from "@askdb/config";
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
} from "@askdb/config/scaffold";

export type SetupDatabase = AskDbScaffoldAnswers["database"];
/** Any provider id with an `askdb.config.*` branch (`ASKDB_AI_PROVIDERS` in `@askdb/config`). */
export type SetupAiProvider = AskDbAiProviderId;
export type SetupRagStore = AskDbScaffoldAnswers["rag"]["store"];
export type SetupExecuteProvider = NonNullable<AskDbScaffoldAnswers["studioExecute"]>["provider"];

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

/** The connection URL variable every live engine defaults to, for introspection and Studio execute. */
const DEFAULT_CONNECTION_ENV = "DATABASE_URL";

/** The pgvector store's connection URL variable, as `askdb init` defaults it. */
const DEFAULT_PGVECTOR_ENV = "PGVECTOR_URL";

/** The planner's name for each answer, mapped to this endpoint's field, for errors. */
const SETUP_FIELDS: Record<string, keyof SetupConfigInput> = {
  connectionEnv: "connectionEnv",
  sqliteFile: "sqliteFile",
  prismaSchemaPath: "prismaSchema",
  schemaOut: "schemaOut",
  "ai.provider": "aiProvider",
  "ai.keyEnv": "aiKeyEnv",
  "ai.modelEnv": "aiModelEnv",
  "rag.store": "ragStore",
  "rag.pgvectorEnv": "pgvectorEnv",
  "studioExecute.provider": "studioExecuteProvider",
  "studioExecute.connectionEnv": "studioExecuteConnectionEnv",
  "studioExecute.sqliteFile": "studioExecuteSqliteFile",
};

/**
 * The request as the planner in `@askdb/config/scaffold` takes it, with Studio's defaults
 * filled in. Paths must stay inside the project; SQLite files are always paths.
 */
function scaffoldAnswers(input: SetupConfigInput): AskDbScaffoldAnswers {
  const executeProvider =
    input.studioExecuteProvider ??
    ((ASKDB_STUDIO_EXECUTE_PROVIDERS as readonly string[]).includes(input.database)
      ? (input.database as SetupExecuteProvider)
      : undefined);
  return {
    database: input.database,
    connectionEnv: trimmed(input.connectionEnv) ?? DEFAULT_CONNECTION_ENV,
    sqliteFile: { path: relativePath(input.sqliteFile ?? "./data.db", "sqliteFile") },
    ...(input.prismaSchema ? { prismaSchemaPath: relativePath(input.prismaSchema, "prismaSchema") } : {}),
    schemaOut: relativePath(input.schemaOut ?? "./askdb", "schemaOut"),
    ai: {
      provider: input.aiProvider,
      keyEnv: trimmed(input.aiKeyEnv) ?? aiDefaults(input.aiProvider)?.keyEnv ?? "",
      ...(input.aiModelEnv ? { modelEnv: input.aiModelEnv.trim() } : {}),
    },
    rag: { store: input.ragStore ?? "file", pgvectorEnv: trimmed(input.pgvectorEnv) ?? DEFAULT_PGVECTOR_ENV },
    ...(input.studioExecute
      ? {
          studioExecute: {
            provider: executeProvider as SetupExecuteProvider,
            connectionEnv: trimmed(input.studioExecuteConnectionEnv) ?? DEFAULT_CONNECTION_ENV,
            sqliteFile: {
              path: relativePath(input.studioExecuteSqliteFile ?? input.sqliteFile ?? "./data.db", "studioExecuteSqliteFile"),
            },
          },
        }
      : {}),
  };
}

function trimmed(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

/** The new project's files and installs, or a 400 that names the request field at fault. */
function planSetup(input: SetupConfigInput): AskDbScaffoldPlan {
  try {
    return planAskDbScaffold(scaffoldAnswers(input), { config: resolveConfigSpec(), prisma: resolvePrismaSpec() });
  } catch (error) {
    if (!(error instanceof AskDbScaffoldInputError)) throw error;
    throw new SetupError(400, `\`${SETUP_FIELDS[error.field] ?? error.field}\` ${error.reason}`);
  }
}

export type SetupConfigResult = {
  configPath: string;
  envExamplePath: string | null;
  /** Env var names the user must fill in `.env` before introspecting / asking. */
  envVars: AskDbScaffoldPlan["envVars"];
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
 * overwrite an existing config. The files come from the same planner as `askdb init`'s.
 */
export function writeSetupConfig(cwd: string, input: SetupConfigInput): SetupConfigResult {
  const existing = discoverAskDbConfigPath(cwd);
  if (existing) {
    throw new SetupError(409, `A config already exists at ${existing}. Edit it directly instead.`);
  }

  const plan = planSetup(input);

  const configPath = join(cwd, "askdb.config.ts");
  writeFileSync(configPath, plan.configSource, "utf8");

  let envExamplePath: string | null = join(cwd, ".env.example");
  if (existsSync(envExamplePath)) {
    envExamplePath = null; // don't clobber an existing example file
  } else {
    writeFileSync(envExamplePath, plan.envExample, "utf8");
  }

  // The config imports `@askdb/config`, so the project needs it (plus the
  // live-introspection driver and, if enabled, the Studio execute driver).
  const deps = ensureProjectDependencies(cwd, plan.install);

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
    envVars: plan.envVars,
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
 * Make sure the project can load the config we just wrote: install the plan's packages
 * it doesn't have yet. Falls back to a manual command when the project looks like a
 * workspace root or the install fails — never mutates a monorepo root implicitly.
 */
function ensureProjectDependencies(cwd: string, install: AskDbScaffoldPlan["install"]): EnsureDepsResult {
  const missing = install.packages.filter((spec) => !isInstalledFor(cwd, packageNameOf(spec)));
  if (missing.length === 0) {
    return { installed: null, manualInstallCommand: null, packageJsonCreated: false };
  }
  const { allowBuilds } = install;

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
  const approvedBuilds = supportedBuildApprovals(pm, pkgDir, allowBuilds);
  // Only auto-install when the project manifest sits exactly at the wizard's
  // directory. A package.json found further up might be a monorepo root or an
  // unrelated project — never mutate those implicitly.
  if (pkgDir !== resolve(cwd) || (isLikelyWorkspaceRoot(pkgDir) && !packageJsonCreated)) {
    return {
      installed: null,
      manualInstallCommand: formatInstallCommand(pm, missing, approvedBuilds),
      packageJsonCreated,
    };
  }

  const installer = setupInstallerForTests ?? runInstall;
  const ok = installer(pm, pkgDir, missing, approvedBuilds);
  if (!ok) {
    return {
      installed: null,
      manualInstallCommand: formatInstallCommand(pm, missing, approvedBuilds),
      packageJsonCreated,
    };
  }
  return { installed: missing, manualInstallCommand: null, packageJsonCreated };
}

/**
 * Whether `packageName` is installed for `dir`: in a `node_modules` of `dir` or a parent,
 * or in a `NODE_PATH` directory. Checked on disk, not with Node's resolver: Node 24 and
 * later can keep a failed lookup until the process exits, so resolving a package this
 * step then installs would hide it from the introspection step's load. Under Yarn
 * Plug'n'Play there is no `node_modules`, and its resolver is the only record, so it asks that.
 */
function isInstalledFor(dir: string, packageName: string): boolean {
  if (process.versions.pnp) {
    try {
      createRequire(join(dir, "package.json")).resolve(packageName);
      return true;
    } catch {
      return false;
    }
  }
  const roots = (process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean);
  for (let current = resolve(dir); ; current = dirname(current)) {
    roots.push(join(current, "node_modules"));
    if (dirname(current) === current) break;
  }
  return roots.some((root) => existsSync(join(root, packageName, "package.json")));
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

/**
 * The `@askdb/prisma` spec to install: Studio's published peer range (`^x`), or the
 * workspace package's version in the monorepo. A range, not the floor: `askdb` hosts
 * Studio and may be released later with a higher floor, which an exact pin to Studio's
 * would break (npm exits with ERESOLVE). `askdb init` pins its own floor.
 */
function resolvePrismaSpec(): string {
  try {
    const require = createRequire(import.meta.url);
    const studioPkg = require("../package.json") as { peerDependencies?: Record<string, string> };
    const declared = studioPkg.peerDependencies?.["@askdb/prisma"];
    if (!declared) return "latest";
    if (!declared.startsWith("workspace:")) return declared;
    const pkgDir = findNearestPackageJsonDir(dirname(require.resolve("@askdb/prisma")));
    if (!pkgDir) return "latest";
    return (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { version?: string }).version ?? "latest";
  } catch {
    return "latest";
  }
}

/** Runs the package manager's add command; `allowBuilds` are the pnpm build approvals it passes. */
type SetupInstaller = (pm: PackageManager, packageDir: string, packages: string[], allowBuilds: string[]) => boolean;

let setupInstallerForTests: SetupInstaller | undefined;

/** @internal Tests only — replaces the real package-manager install. */
export function setSetupInstallerForTests(installer: SetupInstaller | undefined): void {
  setupInstallerForTests = installer;
}

function runInstall(pm: PackageManager, packageDir: string, packages: string[], allowBuilds: string[]): boolean {
  const env = { ...process.env, CI: process.env.CI ?? "true" };
  try {
    const { command, args, shell } = packageManagerSpawnSpec(pm, packageManagerAddArgs(pm, packages, allowBuilds));
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

/** Studio writes only inside the project: a path must be relative and stay below it. */
function relativePath(path: string, field: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath === "" || isAbsolute(trimmedPath) || relative(".", trimmedPath).startsWith("..")) {
    throw new SetupError(
      400,
      `\`${field}\` must be a relative path inside the project (got: ${JSON.stringify(path)}).`,
    );
  }
  return trimmedPath;
}

/** `@askdb/config` from `@askdb/config@1.0.0`, `pg` from `pg`. */
function packageNameOf(spec: string): string {
  const at = spec.indexOf("@", 1);
  return at === -1 ? spec : spec.slice(0, at);
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
