/**
 * The tenant check reads names and comments the way SQLite does, checked against a live SQLite
 * (better-sqlite3) over the shared fixture file.
 *
 * Protects: for each shape where the check once read SQL differently from the engine, the engine's
 * reading is confirmed on the fixture, and the tenant check now requires the scoped table's
 * predicate. A `$` inside a name, a `--` comment that ends only at a line feed, and a `'…'` in a
 * table's place, which SQLite reads as the table's name, are read as SQLite reads them.
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
});
