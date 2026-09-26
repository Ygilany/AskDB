/**
 * Schema artifacts for the fixture, produced the documented way: the installed `askdb`
 * CLI's `askdb introspect`, run as the read-only role. Cached per install target, so
 * switching targets with `pnpm lab:use` always re-introspects.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupportedDialect } from "./dialects.js";
import { LOGICAL_SCHEMAS, SQLITE_FILE, connectionUrl } from "./fixture.js";

export const LAB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATE = join(LAB_ROOT, ".lab");
const ARTIFACTS = join(STATE, "artifacts");

/** The current install target, as recorded by `pnpm lab:use`. */
export function requireInstallTarget(): { label: string } {
  const file = join(STATE, "target.json");
  if (!existsSync(file)) {
    throw new Error("The lab isn't installed yet. Run `pnpm lab:use .` (or `pnpm lab:up`) first.");
  }
  return JSON.parse(readFileSync(file, "utf8")) as { label: string };
}

/**
 * SQLite has no connection URL. The documented way to introspect it
 * (guides/switch-engines) is `introspection.providerConfig.sqlite.file` in the config,
 * then a bare `askdb introspect`. The lab writes that config into its own directory.
 */
function sqliteConfigDir(): string {
  const dir = join(STATE, "config", "sqlite");
  mkdirSync(dir, { recursive: true });
  const config = {
    ai: { provider: "openai", providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } } },
    introspection: { provider: "sqlite", providerConfig: { sqlite: { file: SQLITE_FILE } } },
    rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
  };
  // `.ts`, because the CLI can't load a documented `askdb.config.mjs` (#264). And
  // `defineConfig`, because a plain exported object is rejected (#265).
  writeFileSync(
    join(dir, "askdb.config.ts"),
    `import { defineConfig } from "@askdb/config";\n\nexport default defineConfig(${JSON.stringify(config, null, 2)});\n`,
  );
  return dir;
}

/** `askdb introspect` arguments for each dialect. MariaDB is introspected with the MySQL engine. */
function introspectArgs(dialect: SupportedDialect): { args: string[]; cwd: string } {
  if (dialect === "sqlite") return { args: [], cwd: sqliteConfigDir() };
  return {
    cwd: LAB_ROOT,
    args: [
      "--engine", dialect === "mariadb" ? "mysql" : dialect,
      "--url", connectionUrl(dialect, "reader"),
      // Real schemas on Postgres and SQL Server; one database per logical schema on MySQL and MariaDB.
      "--schemas", LOGICAL_SCHEMAS.join(","),
    ],
  };
}

export function ensureArtifact(dialect: SupportedDialect): string {
  requireInstallTarget();
  const outDir = join(ARTIFACTS, `${dialect}.schema`);
  if (existsSync(join(outDir, "schema.json"))) return outDir;

  const { args, cwd } = introspectArgs(dialect);
  execFileSync(
    join(LAB_ROOT, "node_modules", ".bin", "askdb"),
    ["introspect", ...args, "--schema-id", "multi-engine", "--out", outDir],
    { cwd, stdio: ["ignore", "ignore", "inherit"] },
  );
  return outDir;
}
