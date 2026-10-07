/**
 * Tenant scoping, by behavior: tenant-scoped questions asked through `ask()` with the tenant
 * policy overlay (`scenarios/overlay/tenant-policy.md`), their SQL executed on every engine
 * as the host does, and the rows compared with the oracle kept to the scope's agencies
 * (`src/tenant-oracle.ts`, from the seed data, never from SQL). The design is
 * `docs/specs/consumer-lab.md`, "Tenant scoping, by behavior".
 *
 * The questions and their replies are this suite's own catalog (`scenarios/tenant-questions.json`,
 * `cassettes/<dialect>/tenant-*.json`), served by the replay server. The scoped replies use
 * the `:tenant_agency_ids` placeholder the NL→SQL prompt tells the model to use
 * (`docs/contracts/tenant-policy.md`, "Named placeholder convention"). The negative replies
 * are the "model" as the attacker: no filter, or a filter that doesn't restrict the rows.
 *
 * Each scenario's contract, the regression it catches, why nothing else catches it, and its
 * seam are stated above its `describe`. None needs a production seam: the scope, the
 * enforcement mode and `resolveTenantDescendants` are documented `ask()` inputs
 * (`reference/core-api.mdx`), the policy is a documented artifact file, and the errors are
 * documented exports (`getting-started/troubleshooting.mdx`, "Tenant scope").
 *
 * The scenarios that assert what the docs promise but the product doesn't do are `it.fails`
 * with their issue. Each is written so that the assertion that fails is the leak itself:
 * when `ask()` returns SQL it should have rejected, the test runs that SQL as the host and
 * compares the rows with the scope's oracle first, so the failure message shows the other
 * tenants' rows. An `it.fails` case can't tell that failure from a broken setup (a missing
 * cassette, an overlay that doesn't load), but the same setup runs in the passing scenarios
 * on the same dialect, `tenant-ids` and `tenant-strict-unfiltered`, so a broken setup shows
 * as `FAIL` there.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). Every
 * scenario needs `cli-introspect-engine`, and on MySQL and MariaDB `mysql-databases`;
 * `sql-params` cases need `tenant-driver-markers`, and the hierarchy cases
 * `subtree-resolver` (`src/capabilities.ts`).
 */
import { TenantGuardrailError, TenantScopeError } from "@askdb/core";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { askRaw, settle, type AskExtras, type AskResult, type Settled } from "../src/ask.js";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { normalizeRows } from "../src/fixture.js";
import { executeReadOnly } from "../src/host/execute.js";
import { cassetteSql, loadQuestions, withoutTerminator, type Question } from "../src/model/catalog.js";
import { startReplayServer, type ReplayServer } from "../src/model/replay-server.js";
import { LAB_ROOT } from "../src/paths.js";
import { ALL_AGENCIES, TENANT_ORACLES, VISIBLE } from "../src/tenant-oracle.js";
import { agencyDescendants, agencyRoot, idsScope, removeTenantArtifact, subtreeScope, tenantArtifact, type Enforcement } from "../src/tenant.js";

const TENANT_QUESTIONS = join(LAB_ROOT, "scenarios", "tenant-questions.json");
const QUESTIONS = loadQuestions(TENANT_QUESTIONS);

/** The scoped questions: each one's reply filters on `:tenant_agency_ids`, in a different shape. */
const SCOPED = [
  "tenant-programs", // `agency_id = :p`, rewritten to `IN (…)` for several IDs
  "tenant-client-agencies", // `c.agency_id IN (:p)` on an alias, across schemas, joined to the root table
  "tenant-order-line-counts", // order_line, scoped through its order (the policy's join path)
  "tenant-payments-per-agency", // a decimal SUM per agency
  "tenant-programs-since", // a business parameter too: tenant and business markers in one statement
] as const;
/** The scoped question whose reply is parameterized, so it also returns `unboundSql` + `params`. */
const PARAMETERIZED = "tenant-programs-since";
const MODES = ["sql-only", "sql-params"] as const;
type Mode = (typeof MODES)[number];

/** The flat scope: agency 2, whose child is agency 7. */
const FLAT = 2;
const FLAT_CHILD = 7;

let replay: ReplayServer;
const artifacts = new Map<string, string>();

beforeAll(async () => {
  replay = await startReplayServer({ questionsFile: TENANT_QUESTIONS });
});

afterAll(async () => {
  await replay?.close();
  for (const dir of artifacts.values()) removeTenantArtifact(dir);
});

/**
 * The capabilities every tenant scenario needs: the schema artifacts; on MySQL and MariaDB,
 * all four databases in them, or the overlay has no tables to scope; and in `sql-params`
 * mode, tenant IDs bound through the dialect's driver markers, with `sql` + `tenantParams`
 * an executable pair (both parts of the fix for #231). Postgres needs that only for the
 * question with a business parameter too: its markers have always been `$N`, but before
 * #231 was fixed the tenant markers in `sql` were numbered after the business values while
 * `tenantParams` held the tenant IDs alone. So older targets still run the other Postgres
 * `sql-params` cases.
 */
async function needsTenantCapabilities(ctx: TestContext, dialect: SupportedDialect, mode: Mode = "sql-only", id?: string): Promise<void> {
  needsCapability(ctx, "cli-introspect-engine");
  if (dialect === "mysql" || dialect === "mariadb") needsCapability(ctx, "mysql-databases");
  if (mode === "sql-params" && (dialect !== "postgres" || id === PARAMETERIZED)) await needsCapability(ctx, "tenant-driver-markers");
}

function question(id: string): Question {
  const found = QUESTIONS.find((q) => q.id === id);
  if (!found) throw new Error(`${id} isn't in scenarios/tenant-questions.json`);
  return found;
}

/** The dialect's artifact with the tenant overlay, built once per dialect and enforcement mode. */
function artifact(dialect: SupportedDialect, enforcement: Enforcement = "strict"): string {
  const key = `${dialect}/${enforcement}`;
  if (!artifacts.has(key)) artifacts.set(key, tenantArtifact(dialect, enforcement));
  return artifacts.get(key)!;
}

function ask(dialect: SupportedDialect, id: string, extras: AskExtras, enforcement: Enforcement = "strict"): Promise<AskResult> {
  return askRaw(dialect, question(id).text, artifact(dialect, enforcement), replay.baseURL(dialect), extras);
}


/** The model calls the replay server received for a question. */
const modelCalls = (id: string) => replay.requests().filter((r) => r.questionId === id).length;

/** The oracle's rows for a question, kept to these agencies, normalized. */
function expected(oracleId: string, visible: readonly number[]): unknown[][] {
  const oracle = TENANT_ORACLES[oracleId];
  if (!oracle) throw new Error(`${oracleId} has no oracle in src/tenant-oracle.ts`);
  return normalizeRows(oracle.rows(visible), oracle.types);
}

/** Rows run as the read-only role, normalized for an oracle. The row cap must not have cut them. */
async function run(dialect: SupportedDialect, oracleId: string, sql: string, params?: readonly unknown[]): Promise<unknown[][]> {
  const result = await executeReadOnly(dialect, sql, { params });
  expect(result.truncated, "the host's row cap cut the result").toBe(false);
  return normalizeRows(result.rows, TENANT_ORACLES[oracleId]!.types);
}

/**
 * Every executable pair `ask()` returned (`reference/core-api.mdx`, "Executing the result"),
 * run as the host: `sql` with `tenantParams` (none in `sql-only` mode), and `unboundSql` with
 * `params` when the reply was parameterized. Each must return exactly the visible agencies' rows.
 */
async function expectScopedRows(dialect: SupportedDialect, id: string, mode: Mode, result: AskResult, visible: readonly number[]): Promise<void> {
  const want = expected(id, visible);
  expect(result.sql, "ask() returned SQL with an unsubstituted tenant placeholder").not.toMatch(/:tenant_/);
  if (mode === "sql-params") {
    // Otherwise sql-params mode could inline literals and this case would test sql-only twice.
    expect(new Set(result.tenantParams?.map(String)), "tenantParams must hold the scope's IDs").toEqual(new Set(visible.map(String)));
    expect(await run(dialect, id, result.sql, result.tenantParams)).toEqual(want);
  } else {
    expect(result.tenantParams).toBeUndefined();
    expect(await run(dialect, id, result.sql)).toEqual(want);
  }
  if (id === PARAMETERIZED) {
    expect(result.unboundSql, "ask() dropped unboundSql for a parameterized, tenant-scoped reply").toBeDefined();
    expect(await run(dialect, id, result.unboundSql!, result.params)).toEqual(want);
  }
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  /**
   * Contract: with a tenant policy and `tenantScope { kind: "ids", ids: ["2"] }`, the SQL
   * `ask()` returns is scoped to agency 2: "the tenant predicate is present in the SQL AskDB
   * returns" (`guides/multi-tenancy.mdx`), with the IDs inlined (`sql-only`) or bound through
   * the dialect's driver markers (`sql-params`, `docs/contracts/tenant-policy.md`, "Output
   * modes"). Run as the host, every executable pair returns agency 2's rows, and not those of
   * its child 7: `ids` is flat.
   * Catches: a placeholder substituted with the wrong IDs, the wrong escaping or the wrong
   * markers for a dialect (`$N` on a `?` engine), tenant and business markers bound out of
   * order, `IN (:p)` or an aliased predicate rewritten wrongly, and an `ids` scope widened
   * to descendants.
   * Not covered elsewhere: core's tenant tests run workspace source and never execute the
   * SQL on an engine; the results suite has no tenant policy.
   */
  describe("tenant-ids", () => {
    it.for(SCOPED.flatMap((id) => MODES.map((mode) => [id, mode] as const)))(
      `tenant-ids: %s in %s mode, scoped to agency ${FLAT}, returns agency ${FLAT}'s rows and not its child ${FLAT_CHILD}'s`,
      async ([id, mode], ctx) => {
        await needsTenantCapabilities(ctx, dialect, mode, id);
        // The child's rows must change the answer, or this couldn't tell `ids` from a subtree.
        expect(expected(id, [FLAT])).not.toEqual(expected(id, [FLAT, FLAT_CHILD]));

        const result = await ask(dialect, id, { tenantScope: idsScope(dialect, [FLAT]), tenantSqlMode: mode });

        await expectScopedRows(dialect, id, mode, result, [FLAT]);
      },
    );
  });

  /**
   * Contract: in `sql-only` mode tenant IDs are "replaced with escaped literal values"
   * (`docs/contracts/tenant-policy.md`, "Output modes"), escaped for the dialect, with
   * backslash escapes on for MySQL and MariaDB (`reference/core-api.mdx`, "Executing the
   * result"). AskDB trusts the IDs, but an ID can never become SQL: a hostile ID run as the
   * host returns no row outside the agency its digits name. An engine error from comparing
   * the integer column with a non-numeric string is also safe. MySQL and MariaDB coerce
   * `'2…'` to 2, so the check is "no row outside agency 2", not "no rows".
   * Catches: a regression in the dialect's literal escaping, such as MySQL and MariaDB
   * losing backslash escaping, so `2\' OR 1=1 -- ` closes its literal and widens the filter.
   * Not covered elsewhere: every other tenant ID in the lab is plain digits; core's escaping
   * tests check the string, never what an engine makes of it.
   */
  describe("tenant-ids-hostile", () => {
    const hostile = ["2' OR '1'='1", ...(dialect === "mysql" || dialect === "mariadb" ? ["2\\' OR 1=1 -- "] : [])];
    it.for(hostile)("tenant-ids-hostile: the tenant ID %j, inlined in sql-only mode, returns no row outside agency 2", async (tenantId, ctx) => {
      await needsTenantCapabilities(ctx, dialect);
      const result = await ask(dialect, "tenant-programs", { tenantScope: idsScope(dialect, [tenantId]), tenantSqlMode: "sql-only" });

      const ran = await executeReadOnly(dialect, result.sql).then(
        (r) => ({ ok: true as const, rows: r.rows }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (!ran.ok) return; // the engine refused to compare an integer with the string: nothing leaked
      const outside = ran.rows.filter((row) => String(row[0]) !== String(FLAT));
      expect(outside, `the ID made SQL: ${JSON.stringify(result.sql)} returns rows outside agency ${FLAT}`).toEqual([]);
    });
  });

  /**
   * Contract: a `subtree` scope sees its root agencies and every descendant, never an
   * ancestor or another tree (decision 9 in `docs/specs/consumer-lab.md`), when the host
   * passes `resolveTenantDescendants` (`guides/multi-tenancy.mdx`, "Hierarchical scope
   * (`subtree`)"). The lab is the host: its resolver walks `org.agency.parent_agency_id` on
   * the engine as the read-only role. `ask()` calls it once with the root and the seeds.
   * Catches: descendants dropped (the behavior before #232 was fixed), the resolver's result
   * not substituted or not unioned with the seeds, an ancestor or a sibling tree leaked, and
   * a resolver query that doesn't run on one engine.
   * Not covered elsewhere: core's subtree tests use an in-memory resolver and never execute
   * the SQL; no other lab suite passes a scope.
   */
  describe("tenant-subtree", () => {
    const cases = Object.entries(VISIBLE).flatMap(([seed, visible]) =>
      SCOPED.flatMap((id) => MODES.map((mode) => [Number(seed), visible, id, mode] as const)),
    );
    it.for(cases)("tenant-subtree: agency %s's subtree sees agencies %j only, for %s in %s mode", async ([seed, visible, id, mode], ctx) => {
      await needsTenantCapabilities(ctx, dialect, mode, id);
      await needsCapability(ctx, "subtree-resolver");
      const resolveTenantDescendants = agencyDescendants(dialect);

      const result = await ask(dialect, id, { tenantScope: subtreeScope(dialect, [seed]), tenantSqlMode: mode, resolveTenantDescendants });

      expect(resolveTenantDescendants.calls, "ask() must call the resolver once, with the root and the seed").toEqual([[agencyRoot(dialect), [String(seed)]]]);
      await expectScopedRows(dialect, id, mode, result, visible);
    });
  });

  /**
   * Contract: `ask()` "unions the seed IDs into the `tenantRoot` entry (deduplicated), so an
   * ancestor never loses its own rows when a resolver returns strict descendants only", and it
   * calls the resolver with every seed in `access.rootIds` (`docs/contracts/tenant-policy.md`,
   * "Subtree expansion"; `reference/core-api.mdx`, `resolveTenantDescendants`: "`ask()`
   * unions the seeds in"). So a resolver that returns only 4, 5 and 6 for agency 1 still scopes
   * to 1, 4, 5 and 6; and seeds 5 and 2 together see 2, 5, 6 and 7.
   * Catches: the seed union dropped (the lab's usual resolver returns the seeds itself, so
   * `tenant-subtree` can't see it), or a subtree expanded from its first seed only.
   * Not covered elsewhere: `tenant-subtree` uses one seed and a resolver that returns it.
   */
  describe("tenant-subtree-seeds", () => {
    const cases = [
      ["strict descendants only", [1], [1, 4, 5, 6], true],
      ["two seeds", [5, 2], [2, 5, 6, 7], false],
    ] as const;
    it.for(cases.flatMap((c) => MODES.map((mode) => [c[0], c[1], c[2], mode, c[3]] as const)))(
      "tenant-subtree-seeds: %s, seeds %j see agencies %j only, in %s mode",
      async ([, seeds, visible, mode, strictDescendants], ctx) => {
        const id = "tenant-programs";
        await needsTenantCapabilities(ctx, dialect, mode, id);
        await needsCapability(ctx, "subtree-resolver");
        const resolveTenantDescendants = agencyDescendants(dialect, { strictDescendants });
        // The resolver must leave something to union in, or this couldn't catch a lost union.
        if (strictDescendants) expect((await agencyDescendants(dialect, { strictDescendants })(agencyRoot(dialect), seeds.map(String)))[agencyRoot(dialect)]).not.toContain(String(seeds[0]));

        const result = await ask(dialect, id, { tenantScope: subtreeScope(dialect, [...seeds]), tenantSqlMode: mode, resolveTenantDescendants });

        expect(resolveTenantDescendants.calls, "ask() must call the resolver once, with the root and every seed").toEqual([[agencyRoot(dialect), seeds.map(String)]]);
        await expectScopedRows(dialect, id, mode, result, visible);
      },
    );
  });

  /**
   * Contract: strict enforcement rejects a reply with no tenant filter on a scoped table
   * with `TenantGuardrailError` (`docs/contracts/tenant-policy.md`, "Enforcement modes";
   * `getting-started/troubleshooting.mdx`: "AskDB refuses to return SQL that could leak
   * cross-tenant data"). The same SQL run raw returns other agencies' programs, which is
   * what makes the rejection matter.
   * Catches: a guardrail that misses an unfiltered scoped table, or a strict mode that only
   * warns.
   * Not covered elsewhere: core's guardrail tests check the error on workspace source, but
   * never show the rejected SQL would have leaked on a real engine.
   */
  describe("tenant-strict-unfiltered", () => {
    it("tenant-strict-unfiltered: a reply with no tenant filter leaks when run raw, and strict mode rejects it", async (ctx) => {
      await needsTenantCapabilities(ctx, dialect);
      const id = "tenant-unfiltered";
      const raw = await run(dialect, "tenant-program-names", cassetteSql(dialect, id, QUESTIONS));
      expect(raw, "the reply, run raw, should return every agency's programs").toEqual(expected("tenant-program-names", ALL_AGENCIES));
      expect(raw).not.toEqual(expected("tenant-program-names", [FLAT]));

      const outcome = await settle(ask(dialect, id, { tenantScope: idsScope(dialect, [FLAT]) }));

      expect(outcome.ok ? outcome.result.sql : undefined, "strict mode returned the unfiltered SQL").toBeUndefined();
      expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(TenantGuardrailError);
    });
  });

  /**
   * Contract: strict mode "rejects unproven queries", and the check verifies "the required
   * tenant predicate (`column = :placeholder` …)" (`docs/contracts/tenant-policy.md`,
   * "Guardrail validation"); a table in none of `scopedTables`, `polymorphicTables` or
   * `globalTables` is unknown and blocked. So each of these replies, whose filter is present
   * but doesn't restrict the rows to the scope, must be rejected:
   * - `tenant-strict-column-only`: `agency_id` selected, never filtered;
   * - `tenant-strict-wrong-tenant`: `WHERE agency_id = 1` under a scope for agency 2;
   * - `tenant-strict-or-true`: `WHERE agency_id = :tenant_agency_ids OR 1 = 1`;
   * - `tenant-strict-root-table`: the root table `org.agency`, read with no filter.
   * Catches: a guardrail that accepts a present-but-ineffective filter. Before the fix for
   * #315 it accepted all four: it checked that the tenant column's name appeared, not that
   * it filtered, and it never checked the root table. Releases from before that fix report
   * `n/a (capability: tenant-predicate-required)`.
   * Not covered elsewhere: core's guardrail tests check the rule on SQL text; only this runs
   * the SQL on an engine, to show each reply really leaks.
   */
  const INEFFECTIVE = [
    // scenario, reply, oracle, the agencies the reply returns when run raw
    ["tenant-strict-column-only", "tenant-column-only", "tenant-programs", ALL_AGENCIES],
    ["tenant-strict-wrong-tenant", "tenant-wrong-tenant", "tenant-programs", [1]],
    ["tenant-strict-or-true", "tenant-or-true", "tenant-programs", ALL_AGENCIES],
    ["tenant-strict-root-table", "tenant-root-table", "tenant-agency-names", ALL_AGENCIES],
  ] as const;
  describe.each(INEFFECTIVE.map((c) => [...c]))("%s", (_scenario, id, oracleId, leaks) => {
    // The `it.fails` case below can't tell the leak from a missing or broken cassette. This
    // one can: it must pass, so a broken reply shows as FAIL in the same cell, not `known`.
    it(`the ${id} reply, run raw with the placeholder read as agency ${FLAT}, returns rows outside agency ${FLAT}`, async (ctx) => {
      await needsTenantCapabilities(ctx, dialect);
      // `:tenant_agency_ids` means the scope's IDs; the host reads it as the literal 2 here.
      const sql = cassetteSql(dialect, id, QUESTIONS).replaceAll(":tenant_agency_ids", String(FLAT));

      const raw = await run(dialect, oracleId, sql);

      expect(raw, `the ${id} reply should return agencies ${JSON.stringify(leaks)}' rows`).toEqual(expected(oracleId, leaks));
      expect(raw).not.toEqual(expected(oracleId, [FLAT]));
    });

    it(`strict mode rejects the ${id} reply, whose filter doesn't keep the rows to agency ${FLAT}`, async (ctx) => {
      await needsTenantCapabilities(ctx, dialect);
      await needsCapability(ctx, "tenant-predicate-required");

      const outcome = await settle(ask(dialect, id, { tenantScope: idsScope(dialect, [FLAT]) }));

      if (outcome.ok) {
        // The leak, first: what the host gets from the SQL strict mode returned.
        const got = await run(dialect, oracleId, outcome.result.sql);
        expect(got, `strict mode returned ${JSON.stringify(outcome.result.sql)}; run as the host, it returns rows outside agency ${FLAT}`).toEqual(
          expected(oracleId, [FLAT]),
        );
        expect.fail(`strict mode returned SQL with no provable tenant filter: ${outcome.result.sql}`);
      }
      expect(outcome.error).toBeInstanceOf(TenantGuardrailError);
    });
  });

  /**
   * Contract: with `enforcement: warn`, a reply with no tenant filter is "returned with
   * `tenantWarnings`" (`docs/contracts/tenant-policy.md`, "Enforcement modes";
   * `guides/multi-tenancy.mdx`, "Asking with a tenant scope"): `ask()` returns the SQL and
   * reports the missing predicate in its guardrail result (`tenantGuardrail`,
   * `reference/core-api.mdx`), instead of throwing. `reference/core-api.mdx` names
   * `tenantGuardrail` but not `TenantGuardrailResult`'s fields (`passed`, `warnings[].rule`,
   * `tableId`) or the rule code `MISSING_TENANT_PREDICATE`; this asserts them from the
   * exported types, and #316 asks for them to be documented.
   * Catches: warn mode that throws like strict, or that returns the SQL without the warning.
   * Not covered elsewhere: no other lab suite asks with a warn policy.
   */
  describe("tenant-warn", () => {
    it("tenant-warn: warn mode returns the unfiltered reply's SQL, and its guardrail result reports the missing predicate", async (ctx) => {
      await needsTenantCapabilities(ctx, dialect);

      const result = await ask(dialect, "tenant-unfiltered", { tenantScope: idsScope(dialect, [FLAT]) }, "warn");

      expect(withoutTerminator(result.sql)).toBe(cassetteSql(dialect, "tenant-unfiltered", QUESTIONS));
      expect(result.tenantGuardrail).toMatchObject({ passed: false, warnings: [expect.objectContaining({ rule: "MISSING_TENANT_PREDICATE", tableId: expect.stringMatching(/\.program$/) })] });
    });
  });

  /**
   * Contract: `docs/contracts/tenant-policy.md`, `docs/specs/multi-tenancy.md` and
   * `guides/multi-tenancy.mdx` say warn mode returns its warnings as `tenantWarnings`.
   * `ask()`'s result has no such field: the warnings are in `result.tenantGuardrail`, so a
   * host that reads `tenantWarnings` sees no warning at all (#316).
   * Catches: the docs and the product disagreeing about where a warn-mode caller finds the
   * warnings.
   * Not covered elsewhere: `tenant-warn` reads `tenantGuardrail`, which the docs don't name.
   * This case is `known` only while #316 is open. If #316 is resolved by renaming the docs
   * to `result.tenantGuardrail.warnings`, remove this test: `tenant-warn` then covers the
   * documented field, and a `known` case left behind would assert a field nothing promises.
   * If it is resolved by adding `tenantWarnings`, drop `.fails`.
   * (The guide's "can't be forgotten" wording is also #316, but no test pins it: the
   * contract says warn mode returns the unproven query, which `tenant-warn` checks.)
   */
  describe("tenant-warn-claims", () => {
    it.fails(`warn mode reports the missing predicate as tenantWarnings, as the contract and the guide say (#316)`, async (ctx) => {
      await needsTenantCapabilities(ctx, dialect);
      const result = await ask(dialect, "tenant-unfiltered", { tenantScope: idsScope(dialect, [FLAT]) }, "warn");

      expect((result as { tenantWarnings?: unknown[] }).tenantWarnings, "ask()'s result has no tenantWarnings").toEqual([expect.anything()]);
    });
  });
});

/**
 * Contract: a tenant policy with no `tenantScope` fails closed before the prompt:
 * `TenantScopeError` with reason `MISSING_SCOPE` (`docs/contracts/tenant-policy.md`,
 * "Enforcement rules"; `getting-started/troubleshooting.mdx`), and the model is never called.
 * Catches: a missing scope treated as "no tenancy", or checked only after the model call.
 * Not covered elsewhere: the HTTP suite sees this only through `POST /ask`'s `500` (#277),
 * not the error and its reason. The check runs before any SQL exists, so it's
 * engine-independent and runs once, as `[postgres]`.
 */
describe("[postgres] tenant-missing-scope", () => {
  it("tenant-missing-scope: no tenantScope with a tenant policy throws TenantScopeError MISSING_SCOPE and calls no model", async (ctx) => {
    await needsTenantCapabilities(ctx, "postgres");
    const before = modelCalls("tenant-programs");

    const outcome = await settle(ask("postgres", "tenant-programs", {}));

    expect(outcome.ok ? outcome.result.sql : undefined, "ask() returned SQL with no scope").toBeUndefined();
    expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(TenantScopeError);
    expect(outcome.ok ? undefined : outcome.error).toMatchObject({ reason: "MISSING_SCOPE" });
    expect(modelCalls("tenant-programs")).toBe(before);
  });
});

/**
 * Contract: a `subtree` scope with no `resolveTenantDescendants` throws `TenantScopeError`
 * with reason `SUBTREE_NOT_RESOLVABLE` before calling the model, and never falls back to
 * the seed IDs alone (`guides/multi-tenancy.mdx`, "Hierarchical scope (`subtree`)").
 * Catches: a subtree quietly scoped to its seeds (the behavior before #232 was fixed), which
 * would hide a parent's descendants without an error.
 * Not covered elsewhere: core's unit tests, on workspace source only. Engine-independent, so
 * it runs once, as `[postgres]`.
 */
describe("[postgres] tenant-subtree-no-resolver", () => {
  it("tenant-subtree-no-resolver: a subtree scope with no resolver throws TenantScopeError SUBTREE_NOT_RESOLVABLE and calls no model", async (ctx) => {
    await needsTenantCapabilities(ctx, "postgres");
    await needsCapability(ctx, "subtree-resolver");
    const before = modelCalls("tenant-programs");

    const outcome = await settle(ask("postgres", "tenant-programs", { tenantScope: subtreeScope("postgres", [1]) }));

    expect(outcome.ok ? outcome.result.sql : undefined, "ask() returned SQL for a subtree it couldn't expand").toBeUndefined();
    expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(TenantScopeError);
    expect(outcome.ok ? undefined : outcome.error).toMatchObject({ reason: "SUBTREE_NOT_RESOLVABLE" });
    expect(modelCalls("tenant-programs")).toBe(before);
  });
});
