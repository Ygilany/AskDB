import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { loadChunkerSourcesFromDir } from "../chunker/index.js";
import { buildSchemaIndex } from "../indexer/index.js";
import type { Embedder } from "../types.js";
import { createPgvectorStore } from "./pgvector.js";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";

// Runs only with a live pgvector database: `pnpm pgvector:up && pnpm pgvector:test`
// (sets ASKDB_PGVECTOR_URL).
const connectionString = process.env.ASKDB_PGVECTOR_URL ?? process.env.PGVECTOR_URL;
const run = integrationSuite({ env: [["ASKDB_PGVECTOR_URL", "PGVECTOR_URL"]] });

const FIXTURE_DIR = resolve(__dirname, "../../../../fixtures/schemas/orders-users.schema");

async function withPool<T>(fn: (pool: { query: (sql: string) => Promise<unknown> }) => Promise<T>): Promise<T> {
  const pg = await import("pg");
  const Pool = (pg as unknown as { default?: typeof pg }).default?.Pool ?? pg.Pool;
  const pool = new Pool({ connectionString });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function dropTable(table: string): Promise<void> {
  await withPool((pool) => pool.query(`DROP TABLE IF EXISTS "${table}"`));
}

const embedder: Embedder = async (texts) =>
  texts.map((text) => [text.length + 1, (text.charCodeAt(0) % 17) + 1]);

run("createPgvectorStore integration", () => {
  it("upserts, queries, and deletes against a live pgvector table", async () => {
    const table = `askdb_rag_test_${process.pid}`;
    const store = createPgvectorStore({
      connectionString,
      dimensions: 2,
      table,
      indexStrategy: "none",
    });

    try {
      await store.ensureSchema();

      await store.upsert([
        {
          id: "chunk:orders",
          vector: [1, 0],
          hash: "h-orders",
          payload: {
            id: "chunk:orders",
            type: "table",
            text: "orders",
            schemaId: "orders-users",
            refs: ["table:public.orders"],
            sensitive: false,
          },
        },
        {
          id: "chunk:users",
          vector: [0, 1],
          payload: {
            id: "chunk:users",
            type: "table",
            text: "users",
            schemaId: "orders-users",
            refs: ["table:public.users"],
            sensitive: false,
          },
        },
      ]);

      const queried = await store.query([1, 0], 1, {
        schemaId: "orders-users",
        refs: ["table:public.orders"],
      });
      expect(queried.map((r) => r.id)).toEqual(["chunk:orders"]);

      // Only rows with a stored hash are reported.
      expect(await store.hashesByPrefix!("chunk:")).toEqual({ "chunk:orders": "h-orders" });
      expect((await store.idsBySchema!("orders-users")).sort()).toEqual([
        "chunk:orders",
        "chunk:users",
      ]);

      await store.delete(["chunk:orders"]);
      const afterDelete = await store.query([1, 0], 10, {
        schemaId: "orders-users",
      });
      expect(afterDelete.map((r) => r.id)).not.toContain("chunk:orders");
    } finally {
      await store.close();
      await dropTable(table);
    }
  });

  it("migrates a pre-content_hash table and rejects a dimension mismatch", async () => {
    const table = `askdb_rag_migrate_${process.pid}`;
    try {
      await withPool((pool) =>
        pool.query(
          `CREATE EXTENSION IF NOT EXISTS vector;
           CREATE TABLE "${table}" (
             id text PRIMARY KEY, type text NOT NULL, text text NOT NULL,
             schema_id text NOT NULL, refs jsonb NOT NULL DEFAULT '[]'::jsonb,
             sensitive boolean NOT NULL DEFAULT false, embedding vector(2) NOT NULL
           );`,
        ),
      );
      const store = createPgvectorStore({ connectionString, dimensions: 2, table, indexStrategy: "none" });
      try {
        await store.ensureSchema();
        await store.upsert([
          {
            id: "chunk:s:a",
            vector: [1, 0],
            hash: "h",
            payload: { id: "chunk:s:a", type: "table", text: "a", schemaId: "s", refs: [], sensitive: false },
          },
        ]);
        expect(await store.hashesByPrefix!("chunk:s:")).toEqual({ "chunk:s:a": "h" });
      } finally {
        await store.close();
      }

      const wrongDims = createPgvectorStore({ connectionString, dimensions: 3, table, indexStrategy: "none" });
      try {
        await expect(wrongDims.ensureSchema()).rejects.toThrow(
          /stores 2-dimension embeddings but this store is configured with dimensions=3/,
        );
      } finally {
        await wrongDims.close();
      }
    } finally {
      await dropTable(table);
    }
  });

  it("indexes from a committed lock into a fresh table, then reuses from the store", async () => {
    const table = `askdb_rag_index_${process.pid}`;
    const dir = mkdtempSync(join(tmpdir(), "askdb-rag-pg-"));
    const lockFilePath = join(dir, "schema.lock.json");
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    try {
      // Lock written against a memory store (e.g. committed from a dev machine).
      const { createMemoryStore } = await import("./memory.js");
      await buildSchemaIndex({ schema: sources, embedder, store: createMemoryStore(), embedderId: "e", lockFilePath });

      const store = createPgvectorStore({ connectionString, dimensions: 2, table, indexStrategy: "none" });
      try {
        await store.ensureSchema();
        const first = await buildSchemaIndex({ schema: sources, embedder, store, embedderId: "e", lockFilePath });
        expect(first.stats.chunksIndexed).toBe(first.stats.chunksTotal);
        expect(await store.count({ schemaId: "orders-users" })).toBe(first.stats.chunksTotal);

        const second = await buildSchemaIndex({ schema: sources, embedder, store, embedderId: "e", lockFilePath });
        expect(second.stats.chunksIndexed).toBe(0);
        expect(second.stats.chunksReused).toBe(second.stats.chunksTotal);

        // A second schema sharing the table is untouched by reindexing the first.
        const other = loadChunkerSourcesFromDir(FIXTURE_DIR);
        other.schema.schemaId = "orders-users-other";
        const otherIndex = await buildSchemaIndex({
          schema: other,
          embedder,
          store,
          embedderId: "e",
          lockFilePath: join(dir, "other.lock.json"),
        });
        const shrunk = loadChunkerSourcesFromDir(FIXTURE_DIR);
        shrunk.concepts = undefined;
        await buildSchemaIndex({ schema: shrunk, embedder, store, embedderId: "e", lockFilePath });
        expect(await store.count({ schemaId: "orders-users-other" })).toBe(otherIndex.stats.chunksTotal);
        expect(await store.count({ schemaId: "orders-users", types: ["concept"] })).toBe(0);
      } finally {
        await store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await dropTable(table);
    }
  });
});
