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
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * `ai` and `rag` are required top-level fields (reference/config.mdx, "All top-level
 * fields"). The file is `.ts`, because the CLI can't load a documented `askdb.config.mjs`
 * (#264), and uses `defineConfig`, because a plain exported object is rejected (#265).
 */
function sqliteConfig(): string {
  return `import { defineConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } },
  },
  introspection: {
    provider: "sqlite",
    providerConfig: { sqlite: { file: ${JSON.stringify(SQLITE_FILE)} } },
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
});
`;
}

/** Introspect one fixture database into `outDir` with the installed CLI. */
export function introspectFixture(dialect: Dialect, outDir: string): CliRun {
  const out = ["--schema-id", "multi-engine", "--out", outDir];
  if (dialect === "sqlite") {
    mkdirSync(join(LAB_STATE, "projects"), { recursive: true });
    const project = mkdtempSync(join(LAB_STATE, "projects", "sqlite-"));
    try {
      writeFileSync(join(project, "askdb.config.ts"), sqliteConfig());
      return askdb(["introspect", ...out], project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }
  return askdb([
    "introspect",
    "--engine", dialect === "mariadb" ? "mysql" : dialect,
    "--url", connectionUrl(dialect, "reader"),
    "--schemas", LOGICAL_SCHEMAS.join(","),
    ...out,
  ]);
}
