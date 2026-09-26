/**
 * Schema artifacts for the fixture, produced the documented way: the installed `askdb`
 * CLI's `askdb introspect`, run as the read-only role. Cached per install target, so
 * switching targets with `pnpm lab:use` always re-introspects.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
 * then a bare `askdb introspect`. The lab writes that config into a directory of the
 * caller's own, inside the lab so that the config's `@askdb/config` import resolves.
 */
function writeSqliteConfig(dir: string): void {
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
}

/** `askdb introspect` arguments for each dialect. MariaDB is introspected with the MySQL engine. */
function introspectArgs(dialect: SupportedDialect, scratch: string): { args: string[]; cwd: string } {
  if (dialect === "sqlite") {
    const cwd = join(scratch, "config");
    writeSqliteConfig(cwd);
    return { args: [], cwd };
  }
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

/**
 * The dialect's artifact directory, introspecting on first use. Several `lab ask`
 * processes may start with a cold cache at once, so each introspects into its own
 * scratch directory and renames the result into place. The first rename wins; the
 * others discard theirs, which is the same introspection.
 */
export function ensureArtifact(dialect: SupportedDialect): string {
  requireInstallTarget();
  const outDir = join(ARTIFACTS, `${dialect}.schema`);
  if (existsSync(join(outDir, "schema.json"))) return outDir;

  mkdirSync(ARTIFACTS, { recursive: true });
  const scratch = mkdtempSync(join(ARTIFACTS, `.${dialect}-`));
  try {
    const { args, cwd } = introspectArgs(dialect, scratch);
    const built = join(scratch, "schema");
    execFileSync(
      join(LAB_ROOT, "node_modules", ".bin", "askdb"),
      ["introspect", ...args, "--schema-id", "multi-engine", "--out", built],
      { cwd, stdio: ["ignore", "ignore", "inherit"] },
    );
    try {
      renameSync(built, outDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!(code === "ENOTEMPTY" || code === "EEXIST") || !existsSync(join(outDir, "schema.json"))) throw error;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return outDir;
}
