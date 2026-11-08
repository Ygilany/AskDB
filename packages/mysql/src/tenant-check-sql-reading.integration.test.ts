/**
 * The tenant check reads strings, names and comments the way MySQL and MariaDB do, checked against
 * a live MySQL 8.4 and MariaDB 11.4.
 *
 * Protects: for each shape where the check once read SQL differently from the engine, the engine's
 * reading is confirmed on the fixture, and the tenant check now requires the scoped table's
 * predicate. A `$` inside a name, a table named `user`, a string with the server's default
 * backslash escapes, a `--` comment that ends only at a line feed, a backticked name spelled like
 * the tenant placeholder or holding U+0001, and a letter Unicode lower-casing merges into ASCII
 * (U+212A KELVIN SIGN, which MariaDB keeps apart from `k`; U+0130, which MySQL reads as `i`) are read
 * as the server reads them, and a
 * number ends after its decimal point or exponent, so a keyword written right after it is a keyword.
 * Catches: a reading that drifts back from the engine's, which the unit tests pin but can't prove
 * against a real server.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, validateTenantGuardrails } from "@askdb/core";
import type { NormalizedTenantPolicy, TenantScope } from "@askdb/core";
import { describe, expect, it } from "vitest";
import { createMysqlCatalogQueryRunner } from "./exec/mysql.js";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { FIXTURE_HOST_ENV, connectionUrl } from "../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../fixtures/schemas/agency-multi-tenant.schema"));
const policy: NormalizedTenantPolicy = { ...schema.tenantPolicy!, enforcement: "warn" };
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };

const scopedKeyword = (name: string): NormalizedTenantPolicy => ({
  ...policy,
  scopedTables: [{ id: `table:app.${name}`, scopeThrough: [{ root: "table:public.agencies", column: `table:app.${name}#agency_id` }] }],
  polymorphicTables: [],
  globalTables: [],
  coverage: [],
});

fixtureSuite("the tenant check reads SQL the way MySQL and MariaDB do (live)", () => {
  describe.each(["mysql", "mariadb"] as const)("%s", (engine) => {
    const dialect = { id: engine } as const;
    const findings = (sql: string, p: NormalizedTenantPolicy = policy, d: { id: string; backslashEscapes?: boolean } = dialect) =>
      validateTenantGuardrails(sql, p, scope, { dialect: d }).warnings.map((w) => w.rule);
    const runner = () => createMysqlCatalogQueryRunner(connectionUrl(engine, "reader"));

    it("a `$` inside a name continues the name, as the engine reads it", async () => {
      const rows = (await runner()("SELECT count(*) AS c FROM (SELECT 1 AS x$$y UNION ALL SELECT 2) t")).rows;
      expect(Number(rows[0]![0])).toBe(2);
      expect(findings("SELECT id AS x$$y FROM agencies WHERE id = :tenant_agency_ids UNION ALL SELECT agency_id FROM orders ORDER BY x$$y"))
        .toEqual(["MISSING_TENANT_PREDICATE"]);
    });

    it("a letter Unicode lower-casing merges into ASCII is another letter, as MariaDB reads it", async () => {
      // U+212A KELVIN SIGN: MariaDB keeps it apart from `k`, so z's column is read and both tenants come back;
      // MySQL reads it as `k` and rejects the name as ambiguous.
      const kelvin = "wor\u212Aspace_id";
      const sql = `SELECT count(DISTINCT c.workspace_id) AS n FROM (SELECT 1 AS id, 42 AS workspace_id UNION ALL SELECT 2, 999) c, (SELECT 42 AS ${kelvin}) z WHERE ${kelvin} = 42`;
      if (engine === "mariadb") expect(Number((await runner()(sql)).rows[0]![0])).toBe(2);
      else await expect(runner()(sql)).rejects.toThrow(/ambiguous/i);
      const workspace: NormalizedTenantPolicy = {
        ...policy,
        roots: [{ id: "table:public.Agency", label: "workspace", tenantIdColumn: "table:public.Agency#id" }],
        hierarchy: [],
        scopedTables: [{ id: "table:public.Client", scopeThrough: [{ root: "table:public.Agency", column: "table:public.Client#workspace_id" }] }],
        polymorphicTables: [],
        globalTables: [],
        coverage: [],
      };
      const workspaceScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.Agency", ids: ["42"] } };
      const check = (q: string) => validateTenantGuardrails(q, workspace, workspaceScope, { dialect }).warnings.map((w) => w.rule);
      expect(check(`SELECT c.* FROM Client c, (SELECT 42 AS ${kelvin}) z WHERE ${kelvin} = :tenant_workspace_ids`)).toEqual(["UNICODE_ESCAPED_IDENTIFIER", "MISSING_TENANT_PREDICATE"]);
      expect(check("SELECT c.* FROM Client c WHERE c.WORKSPACE_ID = :tenant_workspace_ids")).toEqual([]);
    });

    it("U+0130 reads as `i` on MySQL and as itself on MariaDB, so the check refuses the name", async () => {
      const dotted = "agency_\u0130d";
      const sql = `SELECT agency_id FROM (SELECT 1 AS ${dotted}) t`;
      if (engine === "mysql") expect(Number((await runner()(sql)).rows[0]![0])).toBe(1);
      else await expect(runner()(sql)).rejects.toThrow(/unknown column/i);
      expect(findings(`SELECT d.* FROM (SELECT z.k AS ${dotted}, o.agency_id, o.id FROM orders o, (SELECT 42 AS k) z) d WHERE d.agency_id = :tenant_agency_ids`))
        .toContain("UNICODE_ESCAPED_IDENTIFIER");
    });

    it("a table named after a keyword stands in table position, as the engine reads it", async () => {
      const rows = (await runner()("SELECT user.x FROM (SELECT 1 AS x) user")).rows;
      expect(Number(rows[0]![0])).toBe(1);
      expect(findings("SELECT * FROM user t", scopedKeyword("user"))).toEqual(["MISSING_TENANT_PREDICATE"]);
    });

    it("a string reads with backslash escapes, the server's default", async () => {
      // `'\''` is one string holding a single quote, so the two sides are equal.
      const rows = (await runner()("SELECT ('\\'' = '\\'') AS eq")).rows;
      expect(Number(rows[0]![0])).toBe(1);
      // A spec that leaves backslashEscapes unset must read it the same way (the field unset = on).
      const sql = String.raw`SELECT * FROM orders WHERE status = 'a\' AND agency_id = :tenant_agency_ids AND status = ' OR 1=1 OR status = ''`;
      expect(findings(sql, policy, { id: engine, backslashEscapes: undefined })).toContain("MISSING_TENANT_PREDICATE");
    });

    it.each(["1=1.0OR 1=1", "1=1e1OR 1=1", "1=.5OR 1=1"])("an OR written right after the number in %s is a keyword, as the engine reads it (GHSA-rhwf-7742-8hwj)", async (tail) => {
      // `(a = 1 AND …) OR 1=1` keeps both rows; without the OR, only a = 1 would.
      const rows = (await runner()(`SELECT count(*) AS c FROM (SELECT 1 AS a UNION ALL SELECT 2) t WHERE a = 1 AND ${tail}`)).rows;
      expect(Number(rows[0]![0])).toBe(2);
      expect(findings(`SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND ${tail}`)).toEqual(["MISSING_TENANT_PREDICATE"]);
    });

    it("a `--` comment ends only at a line feed, as the engine reads it", async () => {
      // The carriage return doesn't end the comment, so the UNION after it stays commented out: one row.
      const rows = (await runner()("SELECT 1 AS a -- x\rUNION ALL SELECT 2")).rows;
      expect(rows.length).toBe(1);
      expect(Number(rows[0]![0])).toBe(1);
      // A predicate written after a carriage-return comment is commented out, so it doesn't count.
      expect(findings("SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids"))
        .toEqual(["MISSING_TENANT_PREDICATE"]);
    });

    it("a backticked name is a name, whatever it holds, as the engine reads it", async () => {
      const count = async (sql: string) => Number((await runner()(sql)).rows[0]![0]);
      // `:tenant_agency_ids` is x's column, not a bound value: the filter is x's 3.
      const agency3 = await count("SELECT count(*) AS c FROM people.client WHERE agency_id = 3");
      expect(await count("SELECT count(*) AS c FROM people.client o CROSS JOIN (SELECT 3 AS `:tenant_agency_ids`) x WHERE o.agency_id = `:tenant_agency_ids`"))
        .toBe(agency3);
      // A U+0001 inside a backticked name is part of it, and the OR after it keeps every row.
      expect(await count("SELECT count(DISTINCT agency_id) AS c FROM people.client CROSS JOIN (SELECT 1 AS a) `\u0001` WHERE agency_id = 3 AND `\u0001`.a = 1 OR 1=1"))
        .toBeGreaterThan(1);
      expect(findings("SELECT o.* FROM orders o CROSS JOIN (SELECT 42 AS `:tenant_agency_ids`) x WHERE o.agency_id = `:tenant_agency_ids`"))
        .toEqual(["MISSING_TENANT_PREDICATE"]);
      expect(findings("SELECT `\u0001`.a FROM orders CROSS JOIN (SELECT 1 AS a) `\u0001` WHERE agency_id = :tenant_agency_ids AND `\u0001`.a = 1 OR 1=1"))
        .toEqual(["MISSING_TENANT_PREDICATE"]);
    });
  });
});
