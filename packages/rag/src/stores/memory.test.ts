import { describe, expect, it } from "vitest";
import type { ChunkPayload } from "../types.js";
import { createMemoryStore } from "./memory.js";

const payload = (id: string, overrides: Partial<ChunkPayload> = {}): ChunkPayload => ({
  id,
  type: "table",
  text: id,
  schemaId: "schema-a",
  refs: ["table:public.orders"],
  sensitive: false,
  ...overrides,
});

describe("createMemoryStore", () => {
  it("upserts, queries by cosine similarity, and deletes records", async () => {
    const store = createMemoryStore();

    await store.upsert([
      { id: "a", vector: [1, 0], payload: payload("a") },
      { id: "b", vector: [0, 1], payload: payload("b") },
      { id: "c", vector: [0.8, 0.2], payload: payload("c") },
    ]);

    const results = await store.query([1, 0], 2);
    expect(results.map((r) => r.id)).toEqual(["a", "c"]);
    expect(results[0].score).toBeCloseTo(1);

    await store.delete(["a"]);
    expect(store.size()).toBe(2);
    expect((await store.query([1, 0], 1))[0].id).toBe("c");
  });

  it("filters by schemaId, type, and refs", async () => {
    const store = createMemoryStore();

    await store.upsert([
      {
        id: "orders-table",
        vector: [1, 0],
        payload: payload("orders-table", { type: "table" }),
      },
      {
        id: "orders-cql",
        vector: [1, 0],
        payload: payload("orders-cql", { type: "cql" }),
      },
      {
        id: "users-cql",
        vector: [1, 0],
        payload: payload("users-cql", {
          type: "cql",
          refs: ["table:public.users"],
        }),
      },
      {
        id: "other-schema",
        vector: [1, 0],
        payload: payload("other-schema", {
          schemaId: "schema-b",
          refs: ["table:public.orders"],
        }),
      },
    ]);

    const results = await store.query([1, 0], 10, {
      schemaId: "schema-a",
      types: ["cql"],
      refs: ["table:public.orders"],
    });

    expect(results.map((r) => r.id)).toEqual(["orders-cql"]);
  });

  it("rejects vectors with inconsistent dimensions", async () => {
    const store = createMemoryStore();
    await store.upsert([{ id: "a", vector: [1, 0], payload: payload("a") }]);

    await expect(
      store.upsert([{ id: "b", vector: [1, 0, 0], payload: payload("b") }]),
    ).rejects.toThrow(/dimension mismatch/i);
  });
});
