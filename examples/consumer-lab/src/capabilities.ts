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
import type { AskGenerateDeps } from "@askdb/core";
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

/**
 * `ask()` on the dialect's tenant artifact (the lab's policy overlay), with `sql` as the
 * model's reply through the documented `deps.generateText` seam, so no model is involved.
 * AskDB and the lab's tenant module are loaded here, so the suites that never ask a
 * tenant-scoped question don't load them (or the drivers). A throw is a broken install,
 * and fails the scenario.
 */
async function askTenantProbe(dialect: "postgres" | "sqlite", sql: string, extras: Record<string, unknown>) {
  const { ask, loadSchema } = await import("@askdb/core");
  const { removeTenantArtifact, tenantArtifact } = await import("./tenant.js");
  const generateText = (async () => ({ text: `\`\`\`sql\n${sql}\n\`\`\`` })) as unknown as NonNullable<AskGenerateDeps["generateText"]>;
  const dir = tenantArtifact(dialect);
  let schema: ReturnType<typeof loadSchema>;
  try {
    schema = loadSchema(dir);
  } finally {
    removeTenantArtifact(dir);
  }
  return ask({
    ...extras,
    question: "A probe for a tenant capability.",
    schema,
    // `model` is required; with `deps.generateText` supplied it is never called.
    model: {} as Parameters<typeof ask>[0]["model"],
    dialect,
    deps: { generateText },
  } as Parameters<typeof ask>[0]);
}

/**
 * Whether `ask()` hands a `subtree` scope to the host's `resolveTenantDescendants`
 * (`reference/core-api.mdx`; `guides/multi-tenancy.mdx`, "Hierarchical scope (`subtree`)"):
 * ask about agency 1's subtree on Postgres with a resolver that only records its call, and
 * see whether it was called with the scope's root and seed. Releases before #232 was fixed
 * accept the option and never call it.
 *
 * The probe asks only whether the resolver is called, not what `ask()` does with its
 * answer: the `tenant-subtree` scenarios test that, so a target that calls the resolver and
 * drops its result fails there instead of reporting `n/a`.
 */
async function askCallsSubtreeResolver(): Promise<boolean> {
  const { agencyRoot, subtreeScope } = await import("./tenant.js");
  const calls: unknown[][] = [];
  await askTenantProbe("postgres", "SELECT program_code FROM org.program WHERE agency_id = :tenant_agency_ids", {
    tenantScope: subtreeScope("postgres", [1]),
    resolveTenantDescendants: (...args: unknown[]) => {
      calls.push(args);
      return ["1"];
    },
  });
  return calls.some(([root, seeds]) => root === agencyRoot("postgres") && JSON.stringify(seeds) === JSON.stringify(["1"]));
}

/**
 * Whether `tenantSqlMode: "sql-params"` binds tenant IDs through the dialect's driver
 * markers (`reference/core-api.mdx`, `tenantSqlMode`: "`?` MySQL/MariaDB/SQLite"): ask on
 * SQLite and check the returned `sql` uses `?`, not Postgres `$N`, and that the scope's ID
 * comes back in `tenantParams`. Releases before the fix for #231 bound them with Postgres
 * `$N` markers on every dialect, which a `?` driver can't bind. Only the marker and the
 * bound value are checked, not how the predicate around them is written.
 */
/**
 * Whether strict mode requires a tenant predicate that actually filters
 * (`docs/contracts/tenant-policy.md`, "Guardrail validation": "the required tenant
 * predicate (`column = :placeholder` …)"): ask on Postgres with a reply that filters on
 * a literal agency, not the placeholder, and see whether `ask()` rejects it. Releases
 * before the fix for #315 accepted any mention of the tenant column.
 */
async function askRequiresTenantPredicate(): Promise<boolean> {
  const { idsScope } = await import("./tenant.js");
  try {
    await askTenantProbe("postgres", "SELECT program_code FROM org.program WHERE agency_id = 1", {
      tenantScope: idsScope("postgres", [2]),
    });
    return false;
  } catch (error) {
    if ((error as { name?: string }).name === "TenantGuardrailError") return true;
    throw error;
  }
}

async function askBindsTenantDriverMarkers(): Promise<boolean> {
  const { idsScope } = await import("./tenant.js");
  const result = await askTenantProbe("sqlite", "SELECT program_code FROM program WHERE agency_id = :tenant_agency_ids", {
    tenantScope: idsScope("sqlite", [2]),
    tenantSqlMode: "sql-params",
  });
  const params = (result as { tenantParams?: readonly unknown[] }).tenantParams ?? [];
  return result.sql.includes("?") && !/\$\d/.test(result.sql) && params.map(String).includes("2");
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

/** Capabilities whose probe runs `ask()`, which is async. A scenario awaits `needsCapability` for these. */
const ASYNC_DETECTORS = {
  /**
   * Expanding a `subtree` tenant scope through the host's `resolveTenantDescendants`
   * (`guides/multi-tenancy.mdx`, "Hierarchical scope (`subtree`)"). Before #232 was fixed
   * (#270), `ask()` ignored the callback and scoped to the seed IDs only.
   */
  "subtree-resolver": askCallsSubtreeResolver,
  /**
   * Tenant IDs in `sql-params` mode bound through the dialect's driver markers (`$N`, `?`,
   * `@pN`), with `sql` + `tenantParams` and `unboundSql` + `params` each an executable pair
   * (`reference/core-api.mdx`, "Executing the result"). Before the fix for #231, every
   * dialect got Postgres `$N` markers.
   */
  "tenant-driver-markers": askBindsTenantDriverMarkers,
  /**
   * Strict mode rejecting a tenant filter that doesn't filter: a literal ID, a column only
   * selected, an `OR`-widened predicate, or an unfiltered root table. Before the fix for
   * #315 the guardrail accepted any mention of the tenant column.
   */
  "tenant-predicate-required": askRequiresTenantPredicate,
} satisfies Record<string, () => Promise<boolean>>;

export type SyncCapability = keyof typeof DETECTORS;
export type AsyncCapability = keyof typeof ASYNC_DETECTORS;
export type Capability = SyncCapability | AsyncCapability;

const detected = new Map<SyncCapability, boolean>();
const detecting = new Map<AsyncCapability, Promise<boolean>>();

export function hasCapability(capability: SyncCapability): boolean {
  if (!detected.has(capability)) detected.set(capability, DETECTORS[capability]());
  return detected.get(capability)!;
}

function hasAsyncCapability(capability: AsyncCapability): Promise<boolean> {
  if (!detecting.has(capability)) detecting.set(capability, ASYNC_DETECTORS[capability]());
  return detecting.get(capability)!;
}

/**
 * Call first in a test that needs `capability`. When the install target lacks it, the
 * test is skipped with the note `capability: …`, which `lab:matrix` shows as `n/a (capability: …)`. This checkout is never allowed
 * to lack one: the lab is written against its docs, so a missing capability there is a
 * regression, not an older target.
 */
export function needsCapability(ctx: TestContext, capability: SyncCapability): void;
export function needsCapability(ctx: TestContext, capability: AsyncCapability): Promise<void>;
export function needsCapability(ctx: TestContext, capability: Capability): void | Promise<void> {
  if (capability in ASYNC_DETECTORS) {
    return hasAsyncCapability(capability as AsyncCapability).then((has) => gate(ctx, capability, has));
  }
  gate(ctx, capability, hasCapability(capability as SyncCapability));
}

function gate(ctx: TestContext, capability: Capability, has: boolean): void {
  if (has) return;
  if (requireInstallTarget().thisCheckout) {
    throw new Error(`this checkout lacks the documented capability "${capability}" that the lab's scenarios need`);
  }
  ctx.skip(`capability: ${capability}`);
}
