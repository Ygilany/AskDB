/**
 * The tenant check reads strings, names and comments the way MySQL and MariaDB do, checked against
 * a live MySQL 8.4 and MariaDB 11.4.
 *
 * Protects: for each shape where the check once read SQL differently from the engine, the engine's
 * reading is confirmed on the fixture, and the tenant check now requires the scoped table's
 * predicate. A `$` inside a name, a table named `user`, a string with the server's default
 * backslash escapes, and a `--` comment that ends only at a line feed are read as the server reads
 * them.
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

    it("a `--` comment ends only at a line feed, as the engine reads it", async () => {
      // The carriage return doesn't end the comment, so the UNION after it stays commented out: one row.
      const rows = (await runner()("SELECT 1 AS a -- x\rUNION ALL SELECT 2")).rows;
      expect(rows.length).toBe(1);
      expect(Number(rows[0]![0])).toBe(1);
      // A predicate written after a carriage-return comment is commented out, so it doesn't count.
      expect(findings("SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids"))
        .toEqual(["MISSING_TENANT_PREDICATE"]);
    });
  });
});
