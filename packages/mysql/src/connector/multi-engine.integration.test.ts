/**
 * Live MySQL and MariaDB introspection against the shared multi-engine fixture
 * (`fixtures/multi-engine`, `pnpm fixture:up`), where each logical schema is its
 * own database (`org`, `people`, `billing`, `ref`).
 *
 * Protects: multi-database introspection. With the databases listed in
 * `filters.schemas` (what `introspection.providerConfig.mysql.databases` and
 * `askdb introspect --schemas` feed), every listed database is read, each
 * becomes its own namespace, and foreign keys that cross databases resolve to the
 * referenced database. The artifact matches the same golden logical schema every
 * engine is held to. Without a list, the connection's database is read as
 * before, under the `public` namespace.
 * Catches: a connector that reads only `DATABASE()`, drops cross-database
 * references, mislabels namespaces, or changes the single-database default.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with
 * ASKDB_REQUIRE_INTEGRATION=1, so a missing fixture fails instead of skipping.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchema } from "@askdb/core";
import { introspect } from "@askdb/introspect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMysqlCatalogQueryRunner } from "../exec/mysql.js";
import { createMysqlConnector } from "./index.js";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";
import {
  FIXTURE_HOST_ENV,
  LOGICAL_SCHEMAS,
  compareToLogicalSchema,
  connectionUrl,
  type SchemaJson,
} from "../../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-multi-engine-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function introspectFixture(engine: "mysql" | "mariadb", outDir: string, schemas?: readonly string[]) {
  const result = await introspect(
    {
      mode: "live",
      runner: createMysqlCatalogQueryRunner(connectionUrl(engine, "reader")),
      ...(schemas ? { filters: { schemas: [...schemas] } } : {}),
    },
    { outDir, schemaId: "multi-engine" },
    { connector: createMysqlConnector() },
  );
  const schemaJson = JSON.parse(readFileSync(join(outDir, "schema.json"), "utf8")) as SchemaJson;
  return { result, schemaJson };
}

fixtureSuite("introspect() against the multi-engine fixture (live MySQL family)", () => {
  describe.each(["mysql", "mariadb"] as const)("%s", (engine) => {
    it("reads every listed database and matches the golden logical schema", async () => {
      const outDir = join(workDir, `${engine}.schema`);
      const { result, schemaJson } = await introspectFixture(engine, outDir, LOGICAL_SCHEMAS);

      expect(result.warnings).toEqual([]);
      expect(loadSchema(outDir).warnings).toEqual([]);
      expect(compareToLogicalSchema(schemaJson, { expectNamespaces: true })).toEqual([]);
    });

    it("without a list, reads only the connection's database under `public`", async () => {
      // The fixture's connection database is `org`.
      const { schemaJson } = await introspectFixture(engine, join(workDir, `${engine}-default.schema`));
      expect(schemaJson.tables.map((t) => `${t.schema}.${t.name}`).sort()).toEqual(["public.agency", "public.program"]);
    });
  });
});
