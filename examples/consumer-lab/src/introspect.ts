/**
 * The one place the lab runs `askdb introspect`: the installed CLI against a fixture
 * database, the way the docs site says to for each engine (`reference/cli.mdx`,
 * `guides/switch-engines.mdx`):
 *
 * - Postgres, SQL Server, MySQL and MariaDB: `askdb introspect --engine … --url …
 *   --schemas org,people,billing,ref`, as the read-only role. MariaDB uses `--engine mysql`.
 *   The logical schemas are real schemas on Postgres and SQL Server, and one database each
 *   on MySQL and MariaDB.
 * - SQLite has no connection URL: `introspection.providerConfig.sqlite.file` in the
 *   project's config, then a bare `askdb introspect`. Each call writes that config into a
 *   fresh project directory under `.lab/`, so concurrent calls never share one, and its
 *   `@askdb/config` import resolves from the lab's node_modules like any nested project's.
 *
 * Every call writes a fresh artifact; caching is `artifacts.ts`'s job.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOGICAL_SCHEMAS, SQLITE_FILE, connectionUrl, type Dialect } from "./fixture.js";
import { LAB_ROOT, LAB_STATE } from "./paths.js";

export const ASKDB_BIN = join(LAB_ROOT, "node_modules", ".bin", "askdb");

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the installed `askdb` binary. */
export function askdb(args: string[], cwd: string = LAB_ROOT): CliRun {
  const run = spawnSync(ASKDB_BIN, args, { cwd, encoding: "utf8" });
  if (run.error) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Run the installed `askdb` binary without blocking the event loop, so an in-process
 * replay server can answer its model call. `env` is added to the lab's environment.
 * Aborting `signal` kills the process.
 */
export function askdbAsync(
  args: string[],
  { cwd = LAB_ROOT, env = {}, signal }: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(ASKDB_BIN, args, { cwd, env: { ...process.env, ...env }, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * The two documented forms of a project's config (`reference/config.mdx`):
 * - `define-config-ts`: `askdb.config.ts` exporting `defineConfig({ … })` from `@askdb/config`,
 *   the form `askdb init` writes. Every release loads it, so it is the default.
 * - `plain-object-mjs`: `askdb.config.mjs` exporting a plain `{ … }`, the form the guides show
 *   (`guides/switch-engines.mdx`) with an extension the reference lists. Releases before #264
 *   and #265 were fixed can't load it: capability `config-plain-mjs`.
 */
export type ConfigForm = "define-config-ts" | "plain-object-mjs";

const CONFIG_FILE: Record<ConfigForm, string> = {
  "define-config-ts": "askdb.config.ts",
  "plain-object-mjs": "askdb.config.mjs",
};

/** The `introspection` block that reads a SQLite file, the fixture's unless `file` is given. */
export function sqliteIntrospection(file: string = SQLITE_FILE): Record<string, unknown> {
  return { provider: "sqlite", providerConfig: { sqlite: { file } } };
}

/**
 * A config with this `introspection` block, in `form`. `ai` and `introspection` are required
 * top-level fields (reference/config.mdx, "All top-level fields").
 */
function projectConfig(introspection: Record<string, unknown>, form: ConfigForm): string {
  const config = `{
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "" } },
  },
  introspection: ${JSON.stringify(introspection)},
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
}`;
  return form === "define-config-ts"
    ? `import { defineConfig } from "@askdb/config";\n\nexport default defineConfig(${config});\n`
    : `export default ${config};\n`;
}

export interface ProjectRun extends CliRun {
  /** What the project directory held after the run, besides its config file. */
  files: string[];
}

/** A fresh project directory under `.lab/projects/` whose config, in `form`, has this `introspection` block. */
function makeProject(introspection: Record<string, unknown>, form: ConfigForm): string {
  mkdirSync(join(LAB_STATE, "projects"), { recursive: true });
  const project = mkdtempSync(join(LAB_STATE, "projects", `${String(introspection.provider)}-`));
  writeFileSync(join(project, CONFIG_FILE[form]), projectConfig(introspection, form));
  return project;
}

const projectFiles = (project: string, form: ConfigForm) => readdirSync(project).filter((f) => f !== CONFIG_FILE[form]);

/**
 * Run the installed `askdb` in a fresh project directory under `.lab/projects/` whose config,
 * in `form`, has this `introspection` block, then remove the directory.
 */
export function askdbInProject(
  introspection: Record<string, unknown>,
  args: string[],
  form: ConfigForm = "define-config-ts",
): ProjectRun {
  const project = makeProject(introspection, form);
  try {
    return { ...askdb(args, project), files: projectFiles(project, form) };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

/** {@link askdbInProject} without blocking the event loop. */
export async function askdbInProjectAsync(introspection: Record<string, unknown>, args: string[], signal?: AbortSignal): Promise<ProjectRun> {
  const project = makeProject(introspection, "define-config-ts");
  try {
    return { ...(await askdbAsync(args, { cwd: project, signal })), files: projectFiles(project, "define-config-ts") };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

/** Where to introspect instead of the fixture's own database (a wrong password, a missing file). */
export interface FixtureConnection {
  /** Replaces the read-only role's URL (Postgres, SQL Server, MySQL, MariaDB). */
  url?: string;
  /** Replaces the fixture's SQLite file. */
  sqliteFile?: string;
}

/**
 * The `askdb` call that introspects one fixture database: its arguments, and for SQLite the
 * `introspection` block of the project to run it in.
 */
function introspectCall(dialect: Dialect, output: string | string[], connection: FixtureConnection): { args: string[]; project?: Record<string, unknown> } {
  const out = ["--schema-id", "multi-engine", ...(typeof output === "string" ? ["--out", output] : output)];
  if (dialect === "sqlite") {
    return { args: ["introspect", ...out], project: sqliteIntrospection(connection.sqliteFile) };
  }
  return {
    args: [
      "introspect",
      "--engine", dialect === "mariadb" ? "mysql" : dialect,
      "--url", connection.url ?? connectionUrl(dialect, "reader"),
      "--schemas", LOGICAL_SCHEMAS.join(","),
      ...out,
    ],
  };
}

/**
 * Introspect one fixture database with the installed CLI. `output` is a directory for
 * `--out`, or the output flags themselves (`["--print"]`).
 */
export function introspectFixture(dialect: Dialect, output: string | string[], connection: FixtureConnection = {}): CliRun {
  const { args, project } = introspectCall(dialect, output, connection);
  return project ? askdbInProject(project, args) : askdb(args);
}

/**
 * {@link introspectFixture} without blocking the event loop, so other engines' work goes on
 * meanwhile. Aborting `signal` kills the CLI.
 */
export function introspectFixtureAsync(dialect: Dialect, output: string | string[], connection: FixtureConnection = {}, signal?: AbortSignal): Promise<CliRun> {
  const { args, project } = introspectCall(dialect, output, connection);
  return project ? askdbInProjectAsync(project, args, signal) : askdbAsync(args, { signal });
}
