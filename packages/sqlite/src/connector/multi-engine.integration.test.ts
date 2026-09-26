/**
 * Live SQLite introspection against the shared multi-engine fixture
 * (`fixtures/multi-engine`, `pnpm fixture:up`).
 *
 * Protects: the Schema v2 artifact rendered from a real SQLite catalog —
 * every table, column, normalized type, nullability, primary key and composite
 * foreign key (in column order), the reserved-word table `order`, views and
 * the single namespace AskDB renders as `public`, compared with the same golden logical schema every engine is held to.
 * Catches: catalog-query or renderer regressions that mocked-runner unit tests
 * can't see, because they don't change when the engine's catalog output does.
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
import { createSqliteCatalogQueryRunner } from "../exec/sqlite.js";
import { createSqliteConnector } from "./index.js";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";
import {
  FIXTURE_HOST_ENV,
  SQLITE_FILE,
  compareToLogicalSchema,
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

fixtureSuite("introspect() against the multi-engine fixture (live SQLite)", () => {
  it("renders a loadable Schema v2 artifact that matches the golden logical schema", async () => {
    const outDir = join(workDir, "multi-engine.schema");
    const result = await introspect(
      { mode: "live", runner: createSqliteCatalogQueryRunner(SQLITE_FILE) },
      { outDir, schemaId: "multi-engine" },
      { connector: createSqliteConnector() },
    );

    expect(result.warnings).toEqual([]);
    expect(loadSchema(outDir).warnings).toEqual([]);
    const schemaJson = JSON.parse(readFileSync(join(outDir, "schema.json"), "utf8")) as SchemaJson;
    expect(compareToLogicalSchema(schemaJson, { expectNamespaces: false })).toEqual([]);
  });
});
