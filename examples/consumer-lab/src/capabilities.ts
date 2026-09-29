/**
 * Documented capabilities a scenario can require. An older install target may lack one;
 * a scenario that needs it then reports `n/a (capability: …)` instead of failing.
 *
 * Each capability is detected from the installed target's public surface (an export,
 * documented `--help` output, the published package manifest, or the documented behavior
 * itself), never from a version string: versions aren't in lockstep,
 * and a checkout carries the same version number as the last release.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "vitest";
import { requireInstallTarget } from "./artifacts.js";
import { ASKDB_BIN, introspectFixture } from "./introspect.js";
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
 * Whether `askdb introspect --schemas` reads more than the connection's database on MySQL:
 * introspect the fixture's MySQL with its four databases listed and look for a table from
 * one other than the connection's (`org`). A run that fails is a broken install, and
 * throws. The probe is the documented behavior itself (`--schemas`, reference/cli.mdx;
 * `introspection.schemas`, guides/switch-engines.mdx), so it can't
 * drift from what the lab's scenarios use.
 */
function mysqlReadsListedDatabases(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "lab-capability-mysql-"));
  try {
    const out = join(dir, "probe.schema");
    const run = introspectFixture("mysql", out);
    if (run.status !== 0) throw new Error(`askdb introspect failed while probing mysql-databases (exit ${run.status}):\n${run.stderr}`);
    const schema = JSON.parse(readFileSync(join(out, "schema.json"), "utf8")) as { tables: { schema: string }[] };
    return schema.tables.some((t) => t.schema === "ref");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The database drivers the docs call optional peers (`reference/packages.mdx`, `guides/switch-engines.mdx`). */
const DRIVERS = ["pg", "mysql2", "mssql", "better-sqlite3"];

/**
 * Whether the installed `@askdb/http-api` leaves the database drivers to the host, as the
 * docs say: its published manifest lists none of them as a dependency (#260). A missing
 * package is a broken install, and throws.
 */
function httpApiLeavesDriversOptional(): boolean {
  const manifest = join(LAB_ROOT, "node_modules", "@askdb", "http-api", "package.json");
  if (!existsSync(manifest)) throw new Error(`${manifest} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  const { dependencies = {} } = JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string> };
  return DRIVERS.every((driver) => !(driver in dependencies));
}

const DETECTORS = {
  /** `askdb introspect --engine <id> --url …` (reference/cli.mdx), how the lab builds every schema artifact. */
  "cli-introspect-engine": () => /--engine\b/.test(cliHelp("introspect")),
  /**
   * Introspecting several MySQL/MariaDB databases at once through `--schemas` (and
   * `introspection.schemas`). Before it, the connector read only
   * the connection's database.
   */
  "mysql-databases": mysqlReadsListedDatabases,
  /**
   * Installing `@askdb/http-api` without a database driver, as the deploy guide's install
   * line does (`guides/deploy-as-http-service.mdx`). Before #260 was fixed it hard-depended
   * on `pg`.
   */
  "http-api-optional-drivers": httpApiLeavesDriversOptional,
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
