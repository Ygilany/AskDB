/**
 * Schema artifacts for the fixture, produced the documented way: the installed `askdb`
 * CLI's `askdb introspect`, run as the read-only role. Cached per install target, so
 * switching targets with `pnpm lab:use` always re-introspects.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGICAL_SCHEMAS, connectionUrl, type Dialect } from "./fixture.js";

export const LAB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = join(LAB_ROOT, ".lab", "artifacts");

/** The current install target, as recorded by `pnpm lab:use`. */
export function installTarget(): { label: string } {
  const file = join(LAB_ROOT, ".lab", "target.json");
  if (!existsSync(file)) {
    throw new Error("The lab isn't installed yet. Run `pnpm lab:use .` (or `pnpm lab:up`) first.");
  }
  return JSON.parse(readFileSync(file, "utf8")) as { label: string };
}

export function ensureArtifact(dialect: Dialect): string {
  installTarget();
  if (dialect !== "postgres") throw new Error(`Introspecting ${dialect} isn't supported yet (see #243).`);
  const outDir = join(ARTIFACTS, `${dialect}.schema`);
  if (existsSync(join(outDir, "schema.json"))) return outDir;

  execFileSync(
    join(LAB_ROOT, "node_modules", ".bin", "askdb"),
    [
      "introspect",
      "--engine", "postgres",
      "--url", connectionUrl("postgres", "reader"),
      "--schemas", LOGICAL_SCHEMAS.join(","),
      "--schema-id", "multi-engine",
      "--out", outDir,
    ],
    { cwd: LAB_ROOT, stdio: ["ignore", "ignore", "inherit"] },
  );
  return outDir;
}
