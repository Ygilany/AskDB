/**
 * Run the installed `askdb` CLI against a fixture database, the way the docs site says to
 * for each engine (`reference/cli.mdx`, `guides/switch-engines.mdx`):
 *
 * - Postgres, SQL Server, MySQL and MariaDB: `askdb introspect --engine … --url …
 *   --schemas org,people,billing,ref`, as the read-only role. MariaDB uses `--engine mysql`.
 * - SQLite: `introspection.providerConfig.sqlite.file` in `askdb.config.ts`, then a bare
 *   `askdb introspect`. The config lives in its own directory under `.lab/`, so its
 *   `@askdb/config` import resolves from the lab's node_modules like any nested project's.
 *
 * Every call writes a fresh artifact; nothing is cached.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_ROOT } from "./artifacts.js";
import { LOGICAL_SCHEMAS, SQLITE_FILE, connectionUrl, type Dialect } from "./fixture.js";

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
    const project = join(LAB_ROOT, ".lab", "projects", "sqlite");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "askdb.config.ts"), sqliteConfig());
    return askdb(["introspect", ...out], project);
  }
  return askdb([
    "introspect",
    "--engine", dialect === "mariadb" ? "mysql" : dialect,
    "--url", connectionUrl(dialect, "reader"),
    "--schemas", LOGICAL_SCHEMAS.join(","),
    ...out,
  ]);
}
