/**
 * The tenant check reads comments and token ends the way SQL Server does, checked against a live
 * SQL Server 2022.
 *
 * Protects: SQL Server ends a `--` comment at a carriage return as well as at a line feed, so a
 * predicate written after the carriage return is code. The engine's reading is confirmed on the
 * fixture, and the tenant check reads the predicate the same way, so a scoped query that filters
 * after a carriage-return comment passes while one that doesn't is required to. SQL Server also
 * ends a number after `0x` or `1E` and a name at U+00A0, U+200B and U+0085, so an `OR` written
 * right after one is a keyword, and the tenant check sees it (#623). It reads `]]` inside a bracketed
 * name as an escaped `]` and nests block comments, so a predicate inside either is no predicate.
 * SQL Server resolves a name through the database collation, which reads fullwidth letters as ASCII
 * and ignores U+200D, so the tenant and sensitive checks refuse a name outside printable ASCII that
 * the schema doesn't spell. A bracketed name spelled like the tenant placeholder, or holding U+0001,
 * is a name.
 * Catches: a reading that drifts back from the engine's, which the unit tests pin but can't prove
 * against a real server.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, validateSensitiveReferences, validateTenantGuardrails } from "@askdb/core";
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
    expect(findings(`SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND ${tail}`)).toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("`]]` inside a bracketed name is an escaped `]`, and block comments nest, as the engine reads them", async () => {
    const runner = createSqlServerCatalogQueryRunner(connectionUrl("sqlserver", "reader"));
    const count = async (sql: string) => Number((await runner(sql)).rows[0]![0]);
    const three = "(SELECT 1 AS agency_id UNION ALL SELECT 2 UNION ALL SELECT 3)";
    expect(await count(`SELECT count(*) AS c FROM ${three} AS [o] WHERE agency_id = 1`)).toBe(1);
    // The alias runs to the last `]`, so the WHERE is part of it and every row comes back.
    expect(await count(`SELECT count(*) AS c FROM ${three} AS [o]] WHERE agency_id = 1 AND [x]`)).toBe(3);
    // The predicate sits inside the outer comment, which the `--` line comment closes.
    expect(await count(`SELECT count(*) AS c FROM ${three} AS o WHERE 1=1 /* /* */ AND agency_id = 1 AND 1=1 -- */`)).toBe(3);
    expect(findings("SELECT * FROM orders AS [o]] WHERE agency_id = :tenant_agency_ids AND [x]")).toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(findings("SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids AND 1=1 -- */"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
  });

  it("the collation resolves a fullwidth or zero-width-joined name to the table or column, so the checks refuse it", async () => {
    const runner = createSqlServerCatalogQueryRunner(connectionUrl("sqlserver", "reader"));
    const count = async (table: string) => Number((await runner(`SELECT count(*) AS c FROM people.${table}`)).rows[0]![0]);
    const clients = await count("client");
    expect(clients).toBeGreaterThan(0);
    // `client` in fullwidth letters, and with a zero-width joiner: the same table.
    expect(await count("[\uff43\uff4c\uff49\uff45\uff4e\uff54]")).toBe(clients);
    expect(await count("[cli\u200dent]")).toBe(clients);
    // `ssn` in fullwidth letters is the ssn column.
    const same = (await runner("SELECT TOP (1) CASE WHEN [\uff53\uff53\uff4e] = ssn THEN 1 ELSE 0 END AS same FROM people.client")).rows;
    expect(Number(same[0]![0])).toBe(1);
    expect(findings("SELECT * FROM [\uff4f\uff52\uff44\uff45\uff52\uff53]")).toEqual(["UNICODE_ESCAPED_IDENTIFIER"]);
    expect(findings("SELECT * FROM [ord\u200ders]")).toEqual(["UNICODE_ESCAPED_IDENTIFIER"]);
    const sensitive = loadSchema(join(here, "../../../fixtures/schemas/orders-users-sensitive.schema"));
    const scan = validateSensitiveReferences("SELECT [secret\u200d_recovery_token] FROM users", sensitive, { dialect });
    expect(scan.unresolvedScope?.issues).toContain("UNICODE_ESCAPED_IDENTIFIER");
  });

  it("a bracketed name is a name, whatever it holds, as the engine reads it", async () => {
    const runner = createSqlServerCatalogQueryRunner(connectionUrl("sqlserver", "reader"));
    const agencies = async (sql: string) => Number((await runner(sql)).rows[0]![0]);
    // [:tenant_agency_ids] is x's column, equal to o.agency_id, so clients of every agency come back.
    expect(await agencies(
      "SELECT count(DISTINCT o.agency_id) AS c FROM people.client o CROSS APPLY (SELECT o.agency_id AS [:tenant_agency_ids]) x WHERE o.agency_id = [:tenant_agency_ids]",
    )).toBeGreaterThan(1);
    // A U+0001 inside a bracketed name is part of it, and the OR after it keeps every row.
    expect(await agencies(
      "SELECT count(DISTINCT agency_id) AS c FROM people.client CROSS JOIN (SELECT 1 AS a) [\u0001] WHERE agency_id = 3 AND [\u0001].a = 1 OR 1=1",
    )).toBeGreaterThan(1);
    expect(findings("SELECT o.* FROM orders o CROSS APPLY (SELECT o.agency_id AS [:tenant_agency_ids]) x WHERE o.agency_id = [:tenant_agency_ids]"))
      .toEqual(["MISSING_TENANT_PREDICATE"]);
    expect(findings("SELECT [\u0001].a FROM orders CROSS JOIN (SELECT 1 AS a) [\u0001] WHERE agency_id = :tenant_agency_ids AND [\u0001].a = 1 OR 1=1"))
      .toContain("MISSING_TENANT_PREDICATE");
  });
});
