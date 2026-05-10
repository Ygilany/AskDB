import { describe, expect, it, vi } from "vitest";
import type { PgClient } from "./pgvector.js";
import { createPgvectorStore } from "./pgvector.js";

describe("createPgvectorStore", () => {
  it("documents table, extension, and HNSW setup SQL without executing it", () => {
    const store = createPgvectorStore({
      client: { query: vi.fn() },
      dimensions: 1536,
      table: "askdb_rag_chunks",
    });

    const sql = store.setupSql();
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(sql).toContain("embedding vector(1536) NOT NULL");
    expect(sql).toContain("USING hnsw");
  });

  it("emits parameterized upsert SQL", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPgvectorStore({
      client: { query },
      dimensions: 2,
      table: "askdb_rag_chunks",
    });

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
    ]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO "askdb_rag_chunks"');
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(params[0]).toEqual(["chunk:orders"]);
    expect(params[6]).toEqual(["[1,0]"]);
  });

  it("applies schema/type/ref filters in query SQL and maps rows to QueryResult", async () => {
    const client: PgClient = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "chunk:orders",
            type: "cql",
            text: "orders cql",
            schema_id: "orders-users",
            refs: ["table:public.orders"],
            sensitive: false,
            score: 0.95,
          },
        ],
      })),
    };
    const store = createPgvectorStore({ client, dimensions: 2 });

    const results = await store.query([1, 0], 3, {
      schemaId: "orders-users",
      types: ["cql"],
      refs: ["table:public.orders"],
    });

    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, unknown[]];
    expect(sql).toContain("schema_id = $3");
    expect(sql).toContain("type = ANY($4::text[])");
    expect(sql).toContain("refs ?| $5::text[]");
    expect(params).toEqual([
      "[1,0]",
      3,
      "orders-users",
      ["cql"],
      ["table:public.orders"],
    ]);
    expect(results).toEqual([
      {
        id: "chunk:orders",
        score: 0.95,
        payload: {
          id: "chunk:orders",
          type: "cql",
          text: "orders cql",
          schemaId: "orders-users",
          refs: ["table:public.orders"],
          sensitive: false,
        },
      },
    ]);
  });

  it("emits parameterized delete SQL", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPgvectorStore({
      client: { query },
      dimensions: 2,
      table: "askdb_rag_chunks",
    });

    await store.delete(["chunk:orders"]);

    expect(query).toHaveBeenCalledWith(
      'DELETE FROM "askdb_rag_chunks" WHERE id = ANY($1::text[])',
      [["chunk:orders"]],
    );
  });
});
