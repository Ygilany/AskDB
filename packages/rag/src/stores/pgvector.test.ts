import { describe, expect, it, vi } from "vitest";
import type { PgClient } from "./pgvector.js";
import { createPgvectorStore, PgvectorDimensionMismatchError } from "./pgvector.js";

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

  /** A client whose table, if any, has an `embedding` column of `existingWidth`; records every query. */
  function clientWithTable(existingWidth: number | undefined) {
    const queries: string[] = [];
    const client: PgClient = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("pg_attribute")) {
          return { rows: existingWidth === undefined ? [] : [{ dimensions: existingWidth }] };
        }
        return { rows: [] };
      }),
    };
    return { client, ddl: () => queries.filter((sql) => sql.includes("CREATE TABLE")) };
  }

  it("reads and writes without a width, but needs one to create the table", async () => {
    const store = createPgvectorStore({ client: clientWithTable(undefined).client, table: "askdb_rag_chunks" });

    expect(() => store.setupSql()).toThrow(/pass dimensions .*detectEmbeddingDimensions/);
    await expect(store.ensureSchema()).rejects.toThrow(/pass dimensions to create table "askdb_rag_chunks"/);
    await expect(store.count()).resolves.toBe(0);
  });

  it("reports the width of an existing table, and none when there's no table", async () => {
    await expect(createPgvectorStore({ client: clientWithTable(1536).client }).tableDimensions()).resolves.toBe(1536);
    await expect(createPgvectorStore({ client: clientWithTable(undefined).client }).tableDimensions()).resolves.toBeUndefined();
  });

  it("refuses to use an existing table of another width, and changes nothing", async () => {
    const { client, ddl } = clientWithTable(1536);
    const store = createPgvectorStore({ client, dimensions: 3072, table: "askdb_rag_chunks" });

    const error = await store.ensureSchema().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PgvectorDimensionMismatchError);
    expect(error).toMatchObject({ table: "askdb_rag_chunks", tableDimensions: 1536, dimensions: 3072 });
    expect((error as Error).message).toMatch(
      /pgvector table "askdb_rag_chunks" stores 1536-dimension vectors, but this store is set up for 3072/,
    );
    expect(ddl()).toEqual([]);
  });

  it.each<[string, number | undefined, number | undefined, string]>([
    ["creates a new table at the given width", undefined, 768, "vector(768)"],
    ["keeps an existing table of the same width", 768, 768, "vector(768)"],
    ["adopts an existing table's width when given none", 768, undefined, "vector(768)"],
  ])("ensureSchema %s", async (_case, existing, dimensions, column) => {
    const { client, ddl } = clientWithTable(existing);
    await createPgvectorStore({ client, dimensions }).ensureSchema();
    expect(ddl()).toEqual([expect.stringContaining(column)]);
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

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
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

  it("rejects vectors whose dimensions don't match the table", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = createPgvectorStore({ client: { query }, dimensions: 3 });
    await expect(
      store.upsert([
        {
          id: "x",
          vector: [1, 0],
          payload: { id: "x", type: "table", text: "x", schemaId: "s", refs: [], sensitive: false },
        },
      ]),
    ).rejects.toThrow(/expects 3-dimension vectors; got 2/);
    expect(query).not.toHaveBeenCalled();
  });

  it("reports stored hashes by id prefix and ids by schema", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("content_hash")
        ? [{ id: "chunk:s:a", content_hash: "h-a" }]
        : [{ id: "chunk:s:a" }, { id: "chunk:table:legacy" }],
    }));
    const store = createPgvectorStore({ client: { query }, dimensions: 2, table: "t" });

    expect(await store.hashesByPrefix!("chunk:s:")).toEqual({ "chunk:s:a": "h-a" });
    const [hashSql, hashParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(hashSql).toContain("left(id, char_length($1::text)) = $1::text");
    expect(hashSql).toContain("content_hash IS NOT NULL");
    expect(hashParams).toEqual(["chunk:s:"]);

    expect(await store.idsBySchema!("s")).toEqual(["chunk:s:a", "chunk:table:legacy"]);
    expect(query.mock.calls[1]).toEqual(['SELECT id FROM "t" WHERE schema_id = $1', ["s"]]);
    expect(store.describe!()).toEqual({ kind: "pgvector", location: "t", dimensions: 2 });
  });

  it("ensureSchema passes when dimensions match or the table is new", async () => {
    for (const rows of [[{ dimensions: 64 }], []]) {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes("pg_attribute") ? rows : [],
      }));
      const store = createPgvectorStore({ client: { query }, dimensions: 64, table: "t" });
      await expect(store.ensureSchema()).resolves.toBeUndefined();
    }
  });
});
