/**
 * The one place the lab runs `askdb introspect`: the installed CLI against a fixture
 * database, the way the docs site says to for each engine (`reference/cli.mdx`,
 * `guides/switch-engines.mdx`):
 *
 * - Postgres, SQL Server, MySQL and MariaDB: `askdb introspect --engine … --url …
 *   --schemas org,people,billing,ref`, as the read-only role. MariaDB uses `--engine mysql`.
 *   The logical schemas are real schemas on Postgres and SQL Server, and one database each
 *   on MySQL and MariaDB.
 * - SQLite has no connection URL: `introspection.providerConfig.sqlite.file` in an
 *   `askdb.config.ts`, then a bare `askdb introspect`. Each call writes that config into a
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
 */
export function askdbAsync(args: string[], { cwd = LAB_ROOT, env = {} }: { cwd?: string; env?: Record<string, string> } = {}): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(ASKDB_BIN, args, { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * An `askdb.config.ts` with this `introspection` block. `ai` and `rag` are required
 * top-level fields (reference/config.mdx, "All top-level fields"). The file is `.ts`,
 * because the CLI can't load a documented `askdb.config.mjs` (#264), and uses
 * `defineConfig`, because a plain exported object is rejected (#265).
 */
function projectConfig(introspection: Record<string, unknown>): string {
  return `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } },
  },
  introspection: ${JSON.stringify(introspection)},
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
});
`;
}

export interface ProjectRun extends CliRun {
  /** What the project directory held after the run, besides its `askdb.config.ts`. */
  files: string[];
}

/** A fresh project directory under `.lab/projects/` whose `askdb.config.ts` has this `introspection` block. */
function makeProject(introspection: Record<string, unknown>): string {
  mkdirSync(join(LAB_STATE, "projects"), { recursive: true });
  const project = mkdtempSync(join(LAB_STATE, "projects", `${String(introspection.provider)}-`));
  writeFileSync(join(project, "askdb.config.ts"), projectConfig(introspection));
  return project;
}

const projectFiles = (project: string) => readdirSync(project).filter((f) => f !== "askdb.config.ts");

/**
 * Run the installed `askdb` in a fresh project directory under `.lab/projects/` whose
 * `askdb.config.ts` has this `introspection` block, then remove the directory.
 */
export function askdbInProject(introspection: Record<string, unknown>, args: string[]): ProjectRun {
  const project = makeProject(introspection);
  try {
    return { ...askdb(args, project), files: projectFiles(project) };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

/** {@link askdbInProject} without blocking the event loop. */
export async function askdbInProjectAsync(introspection: Record<string, unknown>, args: string[]): Promise<ProjectRun> {
  const project = makeProject(introspection);
  try {
    return { ...(await askdbAsync(args, { cwd: project })), files: projectFiles(project) };
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
    const sqlite = { file: connection.sqliteFile ?? SQLITE_FILE };
    return { args: ["introspect", ...out], project: { provider: "sqlite", providerConfig: { sqlite } } };
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

/** {@link introspectFixture} without blocking the event loop, so other engines' work goes on meanwhile. */
export function introspectFixtureAsync(dialect: Dialect, output: string | string[], connection: FixtureConnection = {}): Promise<CliRun> {
  const { args, project } = introspectCall(dialect, output, connection);
  return project ? askdbInProjectAsync(project, args) : askdbAsync(args);
}
