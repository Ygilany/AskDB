/**
 * The tenant check reads names and comments the way SQLite does, checked against a live SQLite
 * (better-sqlite3) over the shared fixture file.
 *
 * Protects: for each shape where the check once read SQL differently from the engine, the engine's
 * reading is confirmed on the fixture, and the tenant check now requires the scoped table's
 * predicate. A `$` inside a name, a `--` comment that ends only at a line feed, a `'…'` in a
 * table's place, which SQLite reads as the table's name, a `'…'` right after a table, which it
 * reads as the table's alias, and a column name or `GROUP BY` key with a non-ASCII letter in
 * another case, which it doesn't fold, are read as SQLite reads them.
 * Catches: a reading that drifts back from the engine's, which the unit tests pin but can't prove
 * against a real engine.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, validateTenantGuardrails } from "@askdb/core";
import type { NormalizedTenantPolicy, TenantScope } from "@askdb/core";
import { expect, it } from "vitest";
import { createSqliteCatalogQueryRunner } from "./exec/sqlite.js";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { FIXTURE_HOST_ENV, SQLITE_FILE } from "../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../fixtures/schemas/agency-multi-tenant.schema"));
const policy: NormalizedTenantPolicy = { ...schema.tenantPolicy!, enforcement: "warn" };
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
const dialect = { id: "sqlite" } as const;

const findings = (sql: string) =>
  validateTenantGuardrails(sql, policy, scope, { dialect }).warnings.map((w) => w.rule);

fixtureSuite("the tenant check reads SQL the way SQLite does (live SQLite)", () => {
  it("a `$` inside a name continues the name, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    const rows = (await runner("SELECT count(*) AS c FROM (SELECT 1 AS x$$y UNION ALL SELECT 2)")).rows;
    expect(Number(rows[0]![0])).toBe(2);
    expect(findings("SELECT id AS x$$y FROM agencies WHERE id = :tenant_agency_ids UNION ALL SELECT agency_id FROM orders ORDER BY x$$y"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a `--` comment ends only at a line feed, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    // The carriage return doesn't end the comment, so the UNION after it stays commented out: one row.
    const rows = (await runner("SELECT 1 AS a -- x\rUNION ALL SELECT 2")).rows;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]![0])).toBe(1);
    expect(findings("SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("a non-ASCII letter in another case names another column, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    // SQLite folds only ASCII letters, so "égency_id" is z's column, not "Égency_id": both clients come back.
    const rows = (await runner(`WITH c (id, "Égency_id") AS (VALUES (1, 42), (2, 999)) SELECT count(DISTINCT c.id) AS n FROM c, (SELECT 42 AS "égency_id") z WHERE "égency_id" = 42`)).rows;
    expect(Number(rows[0]![0])).toBe(2);
    const accented: NormalizedTenantPolicy = {
      ...policy,
      roots: [{ id: "table:public.Agency", label: "agency", tenantIdColumn: "table:public.Agency#id" }],
      hierarchy: [],
      scopedTables: [{ id: "table:public.Client", scopeThrough: [{ root: "table:public.Agency", column: "table:public.Client#Égency_id" }] }],
      polymorphicTables: [],
      globalTables: [],
      coverage: [],
    };
    const accentedScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.Agency", ids: ["42"] } };
    const check = (sql: string) => validateTenantGuardrails(sql, accented, accentedScope, { dialect }).warnings.map((w) => w.rule);
    expect(check(`SELECT c.* FROM Client c, (SELECT 42 AS "égency_id") z WHERE "égency_id" = :tenant_agency_ids`)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(check(`SELECT c.* FROM Client c WHERE c."Égency_id" = :tenant_agency_ids`)).toEqual([]);
  });

  it("a GROUP BY key with a non-ASCII letter in another case is another column, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    // "égency_id" is z's constant, so every tenant's rows land in one group: 2 rows, not tenant 42's 1.
    const rows = (await runner(`WITH c (id, "Égency_id") AS (VALUES (1, 42), (2, 999)) SELECT count(*) AS n FROM c, (SELECT 1 AS "égency_id") z GROUP BY "égency_id" HAVING max(c."Égency_id" = 42) = 1`)).rows;
    expect(Number(rows[0]![0])).toBe(2);
    const accented: NormalizedTenantPolicy = {
      ...policy,
      roots: [{ id: "table:public.Agency", label: "agency", tenantIdColumn: "table:public.Agency#id" }],
      hierarchy: [],
      scopedTables: [{ id: "table:public.Client", scopeThrough: [{ root: "table:public.Agency", column: "table:public.Client#Égency_id" }] }],
      polymorphicTables: [],
      globalTables: [],
      coverage: [],
    };
    const accentedScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.Agency", ids: ["42"] } };
    const check = (sql: string) => validateTenantGuardrails(sql, accented, accentedScope, { dialect }).warnings.map((w) => w.rule);
    expect(check(`SELECT count(*) AS n FROM Client c, (SELECT 1 AS "égency_id") z GROUP BY "égency_id" HAVING "Égency_id" = :tenant_agency_ids`)).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(check(`SELECT c."Égency_id", count(*) FROM Client c GROUP BY c."Égency_id" HAVING c."Égency_id" = :tenant_agency_ids`)).toEqual([]);
  });

  it("a single-quoted name in a table's place is the table, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    const count = async (sql: string) => Number((await runner(sql)).rows[0]![0]);
    const clients = await count("SELECT count(*) AS c FROM client");
    expect(clients).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS c FROM 'client'")).toBe(clients);
    expect(await count("SELECT count(*) AS c FROM main.'client'")).toBe(clients);
    for (const sql of [
      "SELECT * FROM 'orders'",
      "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM 'orders'",
      "SELECT * FROM lookup_states, main.'orders'",
    ]) {
      expect(findings(sql), sql).toEqual(["MISSING_TENANT_PREDICATE"]);
    }
  });

  it("a single-quoted string right after a table is its alias, as the engine reads it", async () => {
    const runner = createSqliteCatalogQueryRunner(SQLITE_FILE);
    const count = async (sql: string) => Number((await runner(sql)).rows[0]![0]);
    const clients = await count("SELECT count(*) AS c FROM client");
    expect(await count("SELECT count(*) AS c FROM client WHERE agency_id = 1")).toBeLessThan(clients);
    // `a` is agency's alias, so `a.agency_id = 1` filters agency, and every client comes back.
    expect(await count("SELECT count(*) AS c FROM agency 'a', client WHERE a.agency_id = 1")).toBe(clients);
    expect(findings("SELECT orders.* FROM sub_agencies 'o', orders WHERE o.agency_id = :tenant_agency_ids")).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(findings("SELECT x.* FROM orders 'x' WHERE x.agency_id = :tenant_agency_ids")).toEqual([]);
  });
});
