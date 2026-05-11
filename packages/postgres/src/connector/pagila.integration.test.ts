/**
 * Live-database integration test against the Pagila fixture
 * (`fixtures/pagila/docker-compose.yml`).
 *
 * Skipped unless `PAGILA_DATABASE_URL` is set so local `pnpm test` and
 * non-Pagila CI jobs stay green. CI runs this file with the env var
 * exported after the docker-compose service is healthy; see
 * `.github/workflows/ci.yml`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchema } from "@askdb/core";
import { introspect } from "@askdb/introspect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";
import { createPostgresConnector } from "./index.js";

const url = process.env.PAGILA_DATABASE_URL;
const pagilaSuite = url ? describe : describe.skip;

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "askdb-introspect-pagila-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

pagilaSuite("introspect() against Pagila (live Postgres)", () => {
  it("produces a v2 directory the Phase 5 loader accepts", async () => {
    const outDir = join(workDir, "pagila.schema");
    const result = await introspect(
      { mode: "live", runner: createPostgresCatalogQueryRunner(url!) },
      { outDir, schemaId: "pagila" },
      { connector: createPostgresConnector() },
    );

    expect(result.warnings).toEqual([]);
    expect(result.isEmpty).toBe(false);
    expect(result.render?.schemaJsonPath).toBeDefined();

    const schema = loadSchema(outDir);
    expect(schema.schemaId).toBe("pagila");
    // Phase 5 loader reports zero warnings for a well-formed v2 directory.
    expect(schema.warnings).toEqual([]);

    // Pagila's canonical tables live under `public`.
    const names = new Set(schema.tables.map((t) => t.name));
    for (const expected of [
      "actor",
      "address",
      "category",
      "city",
      "country",
      "customer",
      "film",
      "film_actor",
      "film_category",
      "inventory",
      "language",
      "payment",
      "rental",
      "staff",
      "store",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("preserves composite primary-key column order on film_actor", async () => {
    const outDir = join(workDir, "pagila.schema");
    await introspect(
      { mode: "live", runner: createPostgresCatalogQueryRunner(url!) },
      { outDir, schemaId: "pagila" },
      { connector: createPostgresConnector() },
    );
    const schema = loadSchema(outDir);

    const filmActor = schema.tables.find((t) => t.name === "film_actor");
    expect(filmActor).toBeDefined();

    // Composite PK column order must be (actor_id, film_id) per Pagila's
    // upstream schema definition.
    const pkCols = filmActor!.columns
      .filter((c) => c.primaryKey)
      .map((c) => c.name);
    expect(pkCols).toEqual(["actor_id", "film_id"]);
  });

  it("is deterministic - two runs produce a byte-identical schema.json", async () => {
    const outA = join(workDir, "pagila-a.schema");
    const outB = join(workDir, "pagila-b.schema");
    await introspect(
      { mode: "live", runner: createPostgresCatalogQueryRunner(url!) },
      { outDir: outA, schemaId: "pagila" },
      { connector: createPostgresConnector() },
    );
    await introspect(
      { mode: "live", runner: createPostgresCatalogQueryRunner(url!) },
      { outDir: outB, schemaId: "pagila" },
      { connector: createPostgresConnector() },
    );
    const a = readFileSync(join(outA, "schema.json"), "utf8");
    const b = readFileSync(join(outB, "schema.json"), "utf8");
    expect(b).toBe(a);
  });

  it("default include filter ['public'] excludes system schemas", async () => {
    const outDir = join(workDir, "pagila.schema");
    const result = await introspect(
      { mode: "live", runner: createPostgresCatalogQueryRunner(url!) },
      { outDir, schemaId: "pagila" },
      { connector: createPostgresConnector() },
    );
    const namespaces = result.schema.schemas.map((s) => s.name);
    expect(namespaces).toContain("public");
    expect(namespaces).not.toContain("information_schema");
    expect(namespaces).not.toContain("pg_catalog");
  });
});
