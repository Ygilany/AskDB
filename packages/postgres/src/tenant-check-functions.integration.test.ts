/**
 * The functions `@askdb/core`'s tenant check refuses because it can't see what they read (#702),
 * checked against a real Postgres catalog.
 *
 * Protects: each core-Postgres name on that list is a function in `pg_proc` on the fixture's
 * Postgres 17, and the tenant check refuses a call to it. A misspelled entry would let the real
 * function through; `pg_proc` here is the independent source of the names.
 * Catches: a typo in the list, or a name dropped from it, that the unit tests (one name per
 * group) can't see.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with ASKDB_REQUIRE_INTEGRATION=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, validateTenantGuardrails } from "@askdb/core";
import { expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "./exec/postgres.js";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { FIXTURE_HOST_ENV, connectionUrl } from "../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

/** Functions that ship with core Postgres. */
const CORE_FUNCTIONS = [
  "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml", "ts_stat", "ts_rewrite",
  "table_to_xml", "table_to_xml_and_xmlschema", "schema_to_xml", "schema_to_xml_and_xmlschema",
  "database_to_xml", "database_to_xml_and_xmlschema", "set_config",
];

/**
 * Functions from the `tablefunc` and `dblink` extensions. The fixture installs neither, so
 * `pg_proc` can't confirm these names, and the test skips them.
 */
const EXTENSION_FUNCTIONS = [
  "crosstab", "crosstab2", "crosstab3", "crosstab4", "connectby",
  "dblink", "dblink_exec", "dblink_connect", "dblink_connect_u", "dblink_open", "dblink_send_query",
  "dblink_fetch", "dblink_get_result",
];

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema(join(here, "../../../fixtures/schemas/agency-multi-tenant.schema"));
const policy = { ...schema.tenantPolicy!, enforcement: "warn" as const };
const scope = { access: { kind: "ids" as const, tenantRoot: "table:public.agencies", ids: ["42"] } };

fixtureSuite("the tenant check's uncheckable Postgres functions (live Postgres)", () => {
  it("are functions in pg_proc, and the tenant check refuses a call to each", async () => {
    const runner = createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader"));
    const list = CORE_FUNCTIONS.map((name) => `'${name}'`).join(", ");
    const result = await runner(`SELECT DISTINCT proname FROM pg_catalog.pg_proc WHERE proname IN (${list}) ORDER BY proname`);
    expect(result.rows.map(([name]) => name)).toEqual([...CORE_FUNCTIONS].sort());

    for (const name of CORE_FUNCTIONS) {
      const warnings = validateTenantGuardrails(`SELECT ${name}('x')`, policy, scope, { dialect: { id: "postgres" } }).warnings;
      expect(warnings.map((w) => w.rule), name).toEqual(["UNCHECKABLE_FUNCTION"]);
    }
  });

  it.skip.each(EXTENSION_FUNCTIONS)("%s: its extension isn't installed on the fixture", () => {});
});
