import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "@askdb/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { introspect } from "./introspect.js";
import {
  createSnapshotExecutor,
  loadCatalogSnapshot,
} from "./postgres/test-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "../../../fixtures/introspect");

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-e2e-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("introspect() - end-to-end (snapshot executor, no live DB)", () => {
  it("returns IntrospectionResult when no renderOptions are passed", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const result = await introspect({
      mode: "live",
      executor: createSnapshotExecutor(snapshot),
    });
    expect(result.schema.schemaId).toBe("introspected");
    expect(result.render).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("connector to renderer to on-disk artifact, single call", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const outDir = join(workDir, "orders-users.schema");

    const result = await introspect(
      { mode: "live", executor: createSnapshotExecutor(snapshot) },
      { outDir, schemaId: "orders-users" },
    );

    expect(result.render?.schemaJsonPath).toBe(resolve(outDir, "schema.json"));

    // The artifact byte-matches the M3 golden.
    const golden = readFileSync(
      resolve(FIXTURE_DIR, "orders-users.expected-schema.json"),
      "utf8",
    );
    const written = readFileSync(result.render!.schemaJsonPath, "utf8");
    expect(written).toBe(golden);

    // It also round-trips through the Phase 5 v2 loader cleanly.
    const loaded = loadSchema(outDir);
    expect(loaded.schemaId).toBe("orders-users");
    expect(loaded.warnings).toEqual([]);
  });

  it("merges connector and render warnings", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const outDir = join(workDir, "orders-users.schema");

    const result = await introspect(
      {
        mode: "live",
        executor: createSnapshotExecutor(snapshot),
        // Unmatched glob causes the connector to emit ambiguous_filter.
        filters: { tables: ["public.does_not_exist"] },
      },
      { outDir, schemaId: "orders-users" },
    );
    expect(result.warnings).toEqual([
      { code: "ambiguous_filter", filter: "public.does_not_exist" },
    ]);
  });

  it("accepts a custom connector via options.connector", async () => {
    const snapshot = loadCatalogSnapshot(
      resolve(FIXTURE_DIR, "orders-users.catalog.json"),
    );
    const calls: string[] = [];
    const connector = {
      engine: "postgres" as const,
      async describe(_input: unknown) {
        calls.push("describe");
        return {
          schema: { schemaId: "stub", schemas: [] },
          warnings: [],
          isEmpty: true,
          viewDefinitions: {},
        };
      },
      templates() {
        throw new Error("not used in this test");
      },
    };
    const result = await introspect(
      { mode: "live", executor: createSnapshotExecutor(snapshot) },
      undefined,
      { connector },
    );
    expect(calls).toEqual(["describe"]);
    expect(result.schema.schemaId).toBe("stub");
  });
});
