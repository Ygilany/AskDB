/**
 * Schema artifacts for the fixture, produced the documented way: the installed `askdb`
 * CLI's `askdb introspect`, run as the read-only role. Cached per install target, so
 * switching targets with `pnpm lab:use` always re-introspects.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SupportedDialect } from "./dialects.js";
import { introspectFixture, introspectFixtureAsync, type CliRun } from "./introspect.js";
import { LAB_STATE } from "./paths.js";

const ARTIFACTS = join(LAB_STATE, "artifacts");
const TARGET_FILE = join(LAB_STATE, "target.json");

/** The current install target, as recorded by `pnpm lab:use`. */
export function requireInstallTarget(): { label: string; thisCheckout?: boolean } {
  if (!existsSync(TARGET_FILE)) {
    throw new Error("The lab isn't installed yet. Run `pnpm lab:use .` (or `pnpm lab:up`) first.");
  }
  return JSON.parse(readFileSync(TARGET_FILE, "utf8")) as { label: string; thisCheckout?: boolean };
}

/**
 * The install record `pnpm lab:use` wrote, as text, or undefined while there is none:
 * `lab:use` removes it while it installs. Any reinstall changes it (`installedAt`), even
 * one that keeps the label.
 */
export function installRecord(): string | undefined {
  try {
    return readFileSync(TARGET_FILE, "utf8");
  } catch {
    return undefined;
  }
}

const artifactDir = (dialect: SupportedDialect) => join(ARTIFACTS, `${dialect}.schema`);

/** A scratch directory to introspect into, beside the cache. */
function scratchDir(dialect: SupportedDialect): string {
  mkdirSync(ARTIFACTS, { recursive: true });
  return mkdtempSync(join(ARTIFACTS, `.${dialect}-`));
}

/** Move a finished introspection into the cache. When another process got there first, keep theirs. */
function adopt(dialect: SupportedDialect, built: string, run: CliRun): string {
  const outDir = artifactDir(dialect);
  if (run.status !== 0) {
    throw new Error(`askdb introspect failed for ${dialect} (exit ${run.status}):\n${run.stderr}`);
  }
  try {
    renameSync(built, outDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(code === "ENOTEMPTY" || code === "EEXIST") || !existsSync(join(outDir, "schema.json"))) throw error;
  }
  return outDir;
}

/**
 * The dialect's artifact directory, introspecting on first use. Several `lab ask`
 * processes may start with a cold cache at once, so each introspects into its own
 * scratch directory and renames the result into place. The first rename wins; the
 * others discard theirs, which is the same introspection.
 */
export function ensureArtifact(dialect: SupportedDialect): string {
  requireInstallTarget();
  if (existsSync(join(artifactDir(dialect), "schema.json"))) return artifactDir(dialect);
  const scratch = scratchDir(dialect);
  try {
    const built = join(scratch, "schema");
    return adopt(dialect, built, introspectFixture(dialect, built));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * {@link ensureArtifact} without blocking the event loop, so `lab ui` introspects every
 * engine at once. Aborting `signal` kills the introspection.
 */
export async function ensureArtifactAsync(dialect: SupportedDialect, signal?: AbortSignal): Promise<string> {
  requireInstallTarget();
  if (existsSync(join(artifactDir(dialect), "schema.json"))) return artifactDir(dialect);
  const scratch = scratchDir(dialect);
  try {
    const built = join(scratch, "schema");
    return adopt(dialect, built, await introspectFixtureAsync(dialect, built, {}, signal));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
