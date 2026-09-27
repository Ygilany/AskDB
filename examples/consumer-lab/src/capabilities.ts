/**
 * Documented capabilities a scenario can require. An older install target may lack one;
 * a scenario that needs it then reports `n/a (capability: …)` instead of failing.
 *
 * Each capability is detected from the installed target's public surface (an export, or
 * documented `--help` output), never from a version string: versions aren't in lockstep,
 * and a checkout carries the same version number as the last release.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "vitest";
import { requireInstallTarget } from "./artifacts.js";
import { ASKDB_BIN } from "./introspect.js";
import { LAB_ROOT } from "./paths.js";

/**
 * `askdb <command> --help`, run where the lab runs askdb. Only help text that lacks a flag
 * means "capability absent". A missing bin, a crash or a non-zero exit is a broken
 * install (or a CLI that can't read the lab's documented config), so it throws and the
 * scenario fails: the lab fails rather than skips.
 */
function cliHelp(...command: string[]): string {
  const bin = ASKDB_BIN;
  if (!existsSync(bin)) throw new Error(`${bin} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  const run = spawnSync(bin, [...command, "--help"], { cwd: LAB_ROOT, encoding: "utf8" });
  if (run.error || run.status !== 0) {
    const why = run.error ? run.error.message : `exit ${run.status ?? run.signal}`;
    throw new Error(`\`askdb ${command.join(" ")} --help\` failed (${why}):\n${run.stderr}`);
  }
  return run.stdout;
}

/**
 * A config field the installed `@askdb/config` declares in its published types. Types
 * are part of the package's public surface, so this is the same kind of evidence as an
 * export.
 */
function configTypes(): string {
  const file = join(LAB_ROOT, "node_modules", "@askdb", "config", "dist", "types.d.ts");
  if (!existsSync(file)) throw new Error(`${file} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  return readFileSync(file, "utf8");
}

const DETECTORS = {
  /** `askdb introspect --engine <id> --url …` (reference/cli.mdx), how the lab builds every schema artifact. */
  "cli-introspect-engine": () => /--engine\b/.test(cliHelp("introspect")),
  /**
   * Introspecting several MySQL/MariaDB databases at once:
   * `introspection.providerConfig.mysql.databases` (guides/switch-engines.mdx), which
   * `--schemas` also feeds. Before it, the connector read only the connection's database.
   */
  "mysql-databases": () => /mysql\?:\s*\{[^}]*\bdatabases\?:/.test(configTypes()),
} satisfies Record<string, () => boolean>;

export type Capability = keyof typeof DETECTORS;

const detected = new Map<Capability, boolean>();

export function hasCapability(capability: Capability): boolean {
  if (!detected.has(capability)) detected.set(capability, DETECTORS[capability]());
  return detected.get(capability)!;
}

/**
 * Call first in a test that needs `capability`. When the install target lacks it, the
 * test is skipped with the note `capability: …`, which `lab:matrix` shows as `n/a (capability: …)`. This checkout is never allowed
 * to lack one: the lab is written against its docs, so a missing capability there is a
 * regression, not an older target.
 */
export function needsCapability(ctx: TestContext, capability: Capability): void {
  if (hasCapability(capability)) return;
  if (requireInstallTarget().thisCheckout) {
    throw new Error(`this checkout lacks the documented capability "${capability}" that the lab's scenarios need`);
  }
  ctx.skip(`capability: ${capability}`);
}
