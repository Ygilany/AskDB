import { expect, it } from "vitest";
import { createPgvectorStore } from "./pgvector.js";
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";

const connectionString = process.env.ASKDB_PGVECTOR_URL ?? process.env.PGVECTOR_URL;
const run = integrationSuite({ env: [["ASKDB_PGVECTOR_URL", "PGVECTOR_URL"]] });

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
      const client = await import("pg");
      const pool = new client.Pool({ connectionString });
      try {
        await pool.query(store.setupSql());
      } finally {
        await pool.end();
      }

      await store.upsert([
        {
          id: "chunk:orders",
          vector: [1, 0],
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

      await store.delete(["chunk:orders"]);
      const afterDelete = await store.query([1, 0], 10, {
        schemaId: "orders-users",
      });
      expect(afterDelete.map((r) => r.id)).not.toContain("chunk:orders");
    } finally {
      await store.close();
      const client = await import("pg");
      const pool = new client.Pool({ connectionString });
      try {
        await pool.query(`DROP TABLE IF EXISTS "${table}"`);
      } finally {
        await pool.end();
      }
    }
  });

  it("reads an existing table's width and refuses a store set up for another", async () => {
    const table = `askdb_rag_width_${process.pid}`;
    const created = createPgvectorStore({ connectionString, dimensions: 3, table, indexStrategy: "none" });
    const other = createPgvectorStore({ connectionString, dimensions: 4, table, indexStrategy: "none" });
    const unsized = createPgvectorStore({ connectionString, table, indexStrategy: "none" });
    try {
      await expect(unsized.tableDimensions()).resolves.toBeUndefined();
      await created.ensureSchema();
      await expect(unsized.tableDimensions()).resolves.toBe(3);
      await expect(other.ensureSchema()).rejects.toThrow(/stores 3-dimension vectors, but this store is set up for 4/);
      await expect(unsized.ensureSchema()).resolves.toBeUndefined();
    } finally {
      const client = await import("pg");
      const pool = new client.Pool({ connectionString });
      try {
        await pool.query(`DROP TABLE IF EXISTS "${table}"`);
      } finally {
        await pool.end();
      }
      await Promise.all([created.close(), other.close(), unsized.close()]);
    }
  });
});
