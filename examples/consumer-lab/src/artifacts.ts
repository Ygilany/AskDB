/**
 * Schema artifacts for the fixture, produced the documented way: the installed `askdb`
 * CLI's `askdb introspect`, run as the read-only role. Cached per install target, so
 * switching targets with `pnpm lab:use` always re-introspects.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SupportedDialect } from "./dialects.js";
import { introspectFixture } from "./introspect.js";
import { LAB_STATE } from "./paths.js";

const ARTIFACTS = join(LAB_STATE, "artifacts");

/** The current install target, as recorded by `pnpm lab:use`. */
export function requireInstallTarget(): { label: string } {
  const file = join(LAB_STATE, "target.json");
  if (!existsSync(file)) {
    throw new Error("The lab isn't installed yet. Run `pnpm lab:use .` (or `pnpm lab:up`) first.");
  }
  return JSON.parse(readFileSync(file, "utf8")) as { label: string };
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
    const built = join(scratch, "schema");
    const run = introspectFixture(dialect, built);
    if (run.status !== 0) {
      throw new Error(`askdb introspect failed for ${dialect} (exit ${run.status}):\n${run.stderr}`);
    }
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
