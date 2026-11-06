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
 * a per-request setting" (`concepts/safety-boundaries.mdx`; `guides/enforce-tenancy-in-the-database.mdx`;
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
 * `tenant-rls-own-tenant`. Contract: a policy keyed on a setting holds only while the SQL it
 * guards can't change that setting, so the database refuses a reply that tries
 * (`guides/enforce-tenancy-in-the-database.mdx`, "Stop the query from changing its tenant" and
 * "Run each query in its own transaction"). Run as `lab_tenant` under agency 2, a reply that
 * switches to agency 3 with `set_config()`, with a stacked `SET LOCAL`, or with `SET LOCAL` in a
 * `DO` block fails with the guide's error for each.
 * Catches: `set_config()` or PL/pgSQL left to `PUBLIC` in `src/lab-postgres.sql`, and a harness
 * that runs the SQL through the simple protocol, which runs every statement in the string. Each
 * of those reads agency 3's programs, as rows or in an error message.
 * Not covered elsewhere: AskDB's checks reject all three, as the guide says (`set_config` is on
 * the function denylist, a stacked statement is `SQL_MULTI_STATEMENT`, and `DO` isn't `SELECT` or
 * `WITH`), but those checks are a lint; this is the only place the database is the one refusing them.
 * Seam: none. The replies are written here, the privileges are the lab's own DDL, and the errors
 * come from Postgres.
 *
 * Needs the lab's Postgres running (`pnpm lab:up`, or `pnpm -C examples/consumer-lab postgres:up`),
 * not an AskDB install. The `beforeAll` seeds it and applies the policies and revokes, so a setup
 * that breaks fails these cells, not `lab:up` and the whole matrix. Informational about AskDB, but
 * a `FAIL` still fails `lab:matrix`: it means the lab's database setup or harness broke. Runs once,
 * as `[postgres]`.
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeRows } from "../src/fixture.js";
import { labPostgresRows, seedLabPostgres } from "../src/lab-postgres.js";
import { cassetteSql, loadQuestions } from "../src/model/catalog.js";
import { LAB_ROOT } from "../src/paths.js";
import { ALL_AGENCIES, TENANT_ORACLES } from "../src/tenant-oracle.js";

const QUESTIONS = loadQuestions(join(LAB_ROOT, "scenarios", "tenant-questions.json"));
const ORACLE = TENANT_ORACLES["tenant-program-names"]!;
const AGENCY = 2;
/** The agency a reply in `tenant-rls-own-tenant` tries to switch to. */
const OTHER_AGENCY = 3;
const PROGRAMS = "SELECT program_code, name FROM org.program";

const expected = (visible: readonly number[]) => normalizeRows(ORACLE.rows(visible), ORACLE.types);
const normalized = (rows: unknown[][]) => normalizeRows(rows, ORACLE.types);

describe("[postgres]", () => {
  beforeAll(seedLabPostgres);

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

  // The three ways one reply can change its own tenant, from "Stop the query from changing its
  // tenant" and "Run each query in its own transaction" in guides/enforce-tenancy-in-the-database.mdx,
  // each with the error Postgres refuses it with. Without the guide's revokes and single-statement
  // run, each reads OTHER_AGENCY's programs: the first and second as rows, the third in its error.
  it.each([
    {
      how: "calls set_config()",
      sql: `SELECT p.* FROM (SELECT set_config('app.agency_id', '${OTHER_AGENCY}', true)) AS s CROSS JOIN LATERAL (${PROGRAMS} OFFSET 0) AS p`,
      refusal: "permission denied for function set_config",
    },
    {
      how: "stacks a SET LOCAL before its SELECT",
      sql: `SET LOCAL app.agency_id = '${OTHER_AGENCY}'; ${PROGRAMS}`,
      refusal: "cannot insert multiple commands into a prepared statement",
    },
    {
      how: "runs SET LOCAL in a DO block",
      sql: `DO $$ BEGIN SET LOCAL app.agency_id = '${OTHER_AGENCY}'; RAISE EXCEPTION 'programs: %', (SELECT string_agg(program_code, ',') FROM org.program); END $$`,
      refusal: "permission denied for language plpgsql",
    },
  ])(`tenant-rls-own-tenant: a reply that $how to switch to agency ${OTHER_AGENCY}, run as lab_tenant under agency ${AGENCY}, is refused by the database`, async ({ sql, refusal }) => {
    await expect(labPostgresRows("tenant", sql, { agencyId: AGENCY })).rejects.toThrow(refusal);
  });
});
