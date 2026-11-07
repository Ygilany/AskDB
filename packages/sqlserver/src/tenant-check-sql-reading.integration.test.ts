/**
 * The tenant check reads comments and token ends the way SQL Server does, checked against a live
 * SQL Server 2022.
 *
 * Protects: SQL Server ends a `--` comment at a carriage return as well as at a line feed, so a
 * predicate written after the carriage return is code. The engine's reading is confirmed on the
 * fixture, and the tenant check reads the predicate the same way, so a scoped query that filters
 * after a carriage-return comment passes while one that doesn't is required to. SQL Server also
 * ends a number after `0x` or `1E` and a name at U+00A0, U+200B and U+0085, so an `OR` written
 * right after one is a keyword, and the tenant check sees it (#623).
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
import { createSqlServerCatalogQueryRunner } from "./exec/sqlserver.js";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { FIXTURE_HOST_ENV, connectionUrl } from "../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../fixtures/schemas/agency-multi-tenant.schema"));
const policy: NormalizedTenantPolicy = { ...schema.tenantPolicy!, enforcement: "warn" };
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
const dialect = { id: "sqlserver" } as const;

const findings = (sql: string) =>
  validateTenantGuardrails(sql, policy, scope, { dialect }).warnings.map((w) => w.rule);

fixtureSuite("the tenant check reads SQL the way SQL Server does (live SQL Server)", () => {
  it("a `--` comment ends at a carriage return, as the engine reads it", async () => {
    const runner = createSqlServerCatalogQueryRunner(connectionUrl("sqlserver", "reader"));
    // The comment ends at the CR, so the second line is code and the UNION runs.
    const rows = (await runner("SELECT count(*) AS c FROM (SELECT 1 AS a --\rUNION ALL SELECT 2) t")).rows;
    expect(Number(rows[0]![0])).toBe(2);
    // A predicate after the carriage return is code, so a query that filters there passes;
    // one whose only predicate is before an unrelated carriage-return comment still needs its own.
    expect(findings("SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids")).toEqual([]);
    expect(findings("SELECT id FROM agencies WHERE id = :tenant_agency_ids --\rUNION ALL SELECT agency_id FROM orders"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it.each([
    ["U+00A0", "1=1\u00a0OR 1=1"],
    ["U+200B", "1=1\u200bOR 1=1"],
    ["U+0085", "1=1\u0085OR 1=1"],
    ["`0x`", "1=0xOR 1=1"],
    ["`1E`", "1=1EOR 1=1"],
  ])("an OR written right after %s is a keyword, as the engine reads it (#623)", async (_label, tail) => {
    const runner = createSqlServerCatalogQueryRunner(connectionUrl("sqlserver", "reader"));
    // `(a = 1 AND …) OR 1=1` keeps both rows; without the OR, only a = 1 would.
    const rows = (await runner(`SELECT count(*) AS c FROM (SELECT 1 AS a UNION ALL SELECT 2) t WHERE a = 1 AND ${tail}`)).rows;
    expect(Number(rows[0]![0])).toBe(2);
    expect(findings(`SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND ${tail}`)).toContain("MISSING_TENANT_PREDICATE");
  });
});
