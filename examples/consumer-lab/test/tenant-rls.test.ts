/**
 * Tenant scoping in the database: the defense in depth the docs recommend next to AskDB's
 * tenant check, shown on the lab's own Postgres (`compose.yml`, `src/lab-postgres.ts`). The
 * design is the optional row of "Tenant scoping, by behavior" in `docs/specs/consumer-lab.md`.
 *
 * Informational: it tests Postgres and the lab's policies, not AskDB. The SQL is the tenant
 * suite's unfiltered reply, read from its cassette; AskDB never sees it here (`tenant.test.ts`
 * shows strict mode rejecting it and warn mode returning it).
 *
 * Contract: "make the database the tenant boundary: Postgres row-level security (RLS) keyed on
 * a per-request setting" (`concepts/safety-boundaries.mdx`, "Enforce tenancy in the database";
 * `guides/multi-tenancy.mdx`). Run as `lab_tenant` with `app.agency_id` set to 2 for the
 * transaction, the unfiltered reply returns exactly agency 2's programs, from the seed-data
 * oracle (`src/tenant-oracle.ts`). Run as `fixture_reader`, which bypasses the policies, the same
 * SQL returns every agency's, so the rows `lab_tenant` misses are there and the policy is what
 * hides them.
 * Catches: the lab's policy missing or not enabled on `org.program` (no rows, or every agency's),
 * a policy keyed on the wrong setting or column, and a setting that doesn't reach the
 * transaction the SQL runs in.
 * Not covered elsewhere: every other lab suite runs on the shared fixture, which has no
 * row-level security; this is the only place a reply that leaks is run under it.
 * Seam: none. The SQL is a cassette, the policies are the lab's own DDL, and the rows come from
 * the driver.
 *
 * Needs the lab's Postgres (`pnpm lab:up`, or `pnpm -C examples/consumer-lab postgres:up`), not
 * an AskDB install. Runs once, as `[postgres]`.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRows } from "../src/fixture.js";
import { labPostgresRows } from "../src/lab-postgres.js";
import { cassetteSql, loadQuestions } from "../src/model/catalog.js";
import { LAB_ROOT } from "../src/paths.js";
import { ALL_AGENCIES, TENANT_ORACLES } from "../src/tenant-oracle.js";

const QUESTIONS = loadQuestions(join(LAB_ROOT, "scenarios", "tenant-questions.json"));
const ORACLE = TENANT_ORACLES["tenant-program-names"]!;
const AGENCY = 2;

const expected = (visible: readonly number[]) => normalizeRows(ORACLE.rows(visible), ORACLE.types);
const normalized = (rows: unknown[][]) => normalizeRows(rows, ORACLE.types);

describe("[postgres] tenant-rls", () => {
  it(`tenant-rls: the unfiltered reply, run as lab_tenant with app.agency_id = ${AGENCY}, returns only agency ${AGENCY}'s programs; as fixture_reader, every agency's`, async () => {
    const sql = cassetteSql("postgres", "tenant-unfiltered", QUESTIONS);
    // Agency 2's programs must be a strict subset, or the policy couldn't be told from no policy.
    expect(expected([AGENCY])).not.toEqual(expected(ALL_AGENCIES));
    expect(expected([AGENCY])).not.toEqual([]);

    const asReader = normalized(await labPostgresRows("reader", sql));
    const asTenant = normalized(await labPostgresRows("tenant", sql, { agencyId: AGENCY }));

    expect(asReader, "fixture_reader, which bypasses row-level security, should read every agency's programs").toEqual(expected(ALL_AGENCIES));
    expect(asTenant, `lab_tenant under agency ${AGENCY}'s policy should read only agency ${AGENCY}'s programs`).toEqual(expected([AGENCY]));
  });
});
