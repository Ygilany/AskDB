/**
 * Live Postgres introspection against the shared multi-engine fixture
 * (`fixtures/multi-engine`, `pnpm fixture:up`). Replaces the Pagila suite.
 *
 * Protects: the Schema v2 artifact rendered from a real Postgres catalog —
 * every table, column, normalized type, nullability, primary key and composite
 * foreign key (in column order), the reserved-word table `billing."order"`, views,
 * multiple schemas, and ADR 0003 (a declaratively partitioned table renders as
 * its parent only). Also byte-identical output across runs, and that an
 * unfiltered run never reads system schemas.
 * Catches: catalog-query or renderer regressions that unit tests over pinned
 * catalog snapshots (fixtures/introspect) can't see, because those snapshots
 * don't change when Postgres's catalog output or our SQL against it does.
 *
 * Skipped unless ASKDB_FIXTURE_HOST is set; CI sets it with
 * ASKDB_REQUIRE_INTEGRATION=1, so a missing fixture fails instead of skipping.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchema } from "@askdb/core";
import { introspect } from "@askdb/introspect";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";
import { createPostgresConnector } from "./index.js";
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

function introspectFixture(outDir: string, schemas: readonly string[] | undefined = LOGICAL_SCHEMAS) {
  return introspect(
    {
      mode: "live",
      runner: createPostgresCatalogQueryRunner(connectionUrl("postgres", "reader")),
      ...(schemas ? { filters: { schemas: [...schemas] } } : {}),
    },
    { outDir, schemaId: "multi-engine" },
    { connector: createPostgresConnector() },
  );
}

fixtureSuite("introspect() against the multi-engine fixture (live Postgres)", () => {
  it("renders a loadable Schema v2 artifact that matches the golden logical schema", async () => {
    const outDir = join(workDir, "multi-engine.schema");
    const result = await introspectFixture(outDir);

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(loadSchema(outDir).warnings).toEqual([]);

    const schemaJson = JSON.parse(readFileSync(join(outDir, "schema.json"), "utf8")) as SchemaJson;
    // Partition leaves (billing.payment_2024, …) would show up as unexpected tables (ADR 0003).
    expect(compareToLogicalSchema(schemaJson, { expectNamespaces: true })).toEqual([]);
  });

  it("is deterministic - two runs produce a byte-identical schema.json", async () => {
    const outA = join(workDir, "a.schema");
    const outB = join(workDir, "b.schema");
    await introspectFixture(outA);
    await introspectFixture(outB);
    expect(readFileSync(join(outB, "schema.json"), "utf8")).toBe(readFileSync(join(outA, "schema.json"), "utf8"));
  });

  it("without a schema filter, never reads system schemas", async () => {
    // What the default include list is is documented two ways (docs/integration/connectors.md:
    // `["public"]`; IntrospectionFilters: all non-system schemas), so this asserts only what
    // both agree on. The conflict is recorded in docs/specs/consumer-lab.md.
    const outDir = join(workDir, "default.schema");
    await introspectFixture(outDir, undefined);
    const schemaJson = JSON.parse(readFileSync(join(outDir, "schema.json"), "utf8")) as SchemaJson;
    const namespaces = new Set(schemaJson.tables.map((t) => t.schema));
    expect([...namespaces].filter((ns) => /^(pg_catalog|information_schema|pg_toast|pg_temp)/.test(ns))).toEqual([]);
  });
});
