import { describe, expect, it } from "vitest";
import { createPgvectorStore } from "./pgvector.js";

const connectionString = process.env.ASKDB_PGVECTOR_URL ?? process.env.PGVECTOR_URL;
const run = connectionString ? describe : describe.skip;

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
});
