/**
 * The tenant check reads strings, names and comments the way Postgres does, checked against a
 * live Postgres 17.
 *
 * Protects: for each shape where the check once read SQL differently from the engine, the engine's
 * reading is confirmed on the fixture, and the tenant check now requires the scoped table's
 * predicate. A `$` inside a name, a `$tag$` string, a table named after a keyword, and where a `--`
 * comment ends, nested block comments, and a column list after a table's alias are all read as
 * Postgres reads them.
 * Catches: a reading that drifts back from the engine's, which the unit tests pin but can't prove
 * against a real server.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, validateTenantGuardrails } from "@askdb/core";
import type { NormalizedTenantPolicy, TenantScope } from "@askdb/core";
import { expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "./exec/postgres.js";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { FIXTURE_HOST_ENV, connectionUrl } from "../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../fixtures/schemas/agency-multi-tenant.schema"));
const policy: NormalizedTenantPolicy = { ...schema.tenantPolicy!, enforcement: "warn" };
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
const dialect = { id: "postgres" } as const;

/** A policy scoping a table named after a keyword, to confirm an unquoted spelling is checked. */
const scopedKeyword = (name: string): NormalizedTenantPolicy => ({
  ...policy,
  scopedTables: [{ id: `table:app.${name}`, scopeThrough: [{ root: "table:public.agencies", column: `table:app.${name}#agency_id` }] }],
  polymorphicTables: [],
  globalTables: [],
  coverage: [],
});

const findings = (sql: string, p: NormalizedTenantPolicy = policy) =>
  validateTenantGuardrails(sql, p, scope, { dialect }).warnings.map((w) => w.rule);

fixtureSuite("the tenant check reads SQL the way Postgres does (live Postgres)", () => {
  it("a `$` inside a name continues the name, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    // The engine reads `x$$y` as one column name, so the UNION after it is code, not a string body.
    const rows = (await runner("SELECT count(*) AS c FROM (SELECT 1 AS x$$y UNION ALL SELECT 2) t")).rows;
    expect(Number(rows[0]![0])).toBe(2);
    expect(findings("SELECT id AS x$$y FROM agencies WHERE id = :tenant_agency_ids UNION ALL SELECT agency_id FROM orders ORDER BY x$$y"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a `$tag$…$tag$` string is a string, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    const rows = (await runner("SELECT $q$ a $q$ AS v")).rows;
    expect(String(rows[0]![0])).toBe(" a ");
    // Inside the string the column mention isn't code, so a predicate written only there doesn't count.
    expect(findings("SELECT * FROM orders WHERE note = $q$agency_id = :tenant_agency_ids$q$"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a non-ASCII dollar tag opens a string, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    // `$é$ … $é$` is a dollar-quoted string: the engine reads its body as data, not code.
    const rows = (await runner("SELECT $é$ a $é$ AS v")).rows;
    expect(String(rows[0]![0])).toBe(" a ");
    // So the OR after such a string is code, and the predicate beside it doesn't count.
    expect(findings("SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND $é$'$é$ = '' OR 1=1 OR 'x' = 'x'"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a table named after a keyword stands in table position, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    for (const name of ["lock", "qualify", "by"]) {
      const rows = (await runner(`SELECT ${name}.x FROM (SELECT 1 AS x) ${name}`)).rows;
      expect(Number(rows[0]![0]), name).toBe(1);
      expect(findings(`SELECT * FROM ${name} t`, scopedKeyword(name)), name).toEqual(["MISSING_TENANT_PREDICATE"]);
    }
  });

  it("a `--` comment ends at a carriage return, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    // The comment ends at the CR, so the second line is code and the UNION runs.
    const rows = (await runner("SELECT count(*) AS c FROM (SELECT 1 AS a --\rUNION ALL SELECT 2) t")).rows;
    expect(Number(rows[0]![0])).toBe(2);
    expect(findings("SELECT id FROM agencies WHERE id = :tenant_agency_ids --\rUNION ALL SELECT agency_id FROM orders"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("block comments nest, as the engine reads them", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    // The predicate sits inside the outer comment, which the `--` line comment closes, so both rows come back.
    const rows = (await runner("SELECT count(*) AS c FROM (SELECT 1 AS agency_id UNION ALL SELECT 2) t WHERE 1=1 /* /* */ AND agency_id = 1 AND 1=1 -- */")).rows;
    expect(Number(rows[0]![0])).toBe(2);
    expect(findings("SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids AND 1=1 -- */"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a column list after a table's alias renames the table's first columns, as the engine reads it", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    // people.client's first column is client_id, so `t.agency_id = 3` keeps client 3, whose agency isn't 3.
    const rows = (await runner("SELECT count(*) AS c FROM people.client t (agency_id, real_agency) WHERE t.agency_id = 3 AND t.real_agency <> 3")).rows;
    expect(Number(rows[0]![0])).toBeGreaterThan(0);
    for (const sql of [
      "SELECT * FROM orders t (agency_id, x) WHERE t.agency_id = :tenant_agency_ids",
      "SELECT * FROM orders AS t (agency_id, x) WHERE agency_id = :tenant_agency_ids",
      "SELECT * FROM (SELECT * FROM orders t (agency_id, x) WHERE t.agency_id = :tenant_agency_ids) d",
    ]) {
      expect(findings(sql), sql).toEqual(["MISSING_TENANT_PREDICATE"]);
    }
  });
});
