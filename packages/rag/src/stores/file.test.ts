import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChunkPayload } from "../types.js";
import { createFileStore } from "./file.js";
import { buildSchemaIndex } from "../indexer/index.js";
import { loadChunkerSourcesFromDir } from "../chunker/index.js";
import type { Embedder } from "../types.js";

const FIXTURE_DIR = join(
  __dirname,
  "../../../../fixtures/schemas/orders-users.schema",
);

const tempDirs: string[] = [];

function tempBasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-file-"));
  tempDirs.push(dir);
  return join(dir, "schema");
}

function payload(id: string): ChunkPayload {
  return {
    id,
    type: "table",
    text: id,
    schemaId: "orders-users",
    refs: ["table:public.orders"],
    sensitive: false,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createFileStore", () => {
  it("round-trips vectors and payloads through disk", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });

    await store.upsert([
      { id: "orders", vector: [1, 0, 0], payload: payload("orders") },
      { id: "users", vector: [0, 1, 0], payload: payload("users") },
    ]);
    store.flush();

    const reloaded = createFileStore({ basePath });
    expect(reloaded.size()).toBe(2);

    const results = await reloaded.query([1, 0, 0], 1);
    expect(results[0]).toMatchObject({
      id: "orders",
      payload: { id: "orders", schemaId: "orders-users" },
    });
    expect(results[0].score).toBeCloseTo(1);
  });

  it("persists deletions", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([
      { id: "orders", vector: [1, 0], payload: payload("orders") },
      { id: "users", vector: [0, 1], payload: payload("users") },
    ]);

    await store.delete(["orders"]);

    const reloaded = createFileStore({ basePath });
    expect(reloaded.size()).toBe(1);
    expect((await reloaded.query([1, 0], 10)).map((r) => r.id)).toEqual(["users"]);
  });

  it("supports indexer lock-file reuse after store reload", async () => {
    const basePath = tempBasePath();
    const lockFilePath = `${basePath}.lock.json`;
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const embedder: Embedder = async (texts) => texts.map((text) => [text.length, 1]);

    const first = await buildSchemaIndex({
      schema: sources,
      embedder,
      store: createFileStore({ basePath }),
      embedderId: "test:file-reuse",
      lockFilePath,
    });
    const secondEmbedderCalls: string[][] = [];
    const second = await buildSchemaIndex({
      schema: sources,
      embedder: async (texts) => {
        secondEmbedderCalls.push(texts);
        return embedder(texts);
      },
      store: createFileStore({ basePath }),
      embedderId: "test:file-reuse",
      lockFilePath,
    });

    expect(first.stats.chunksIndexed).toBe(first.stats.chunksTotal);
    expect(second.stats.chunksIndexed).toBe(0);
    expect(second.stats.chunksReused).toBe(second.stats.chunksTotal);
    expect(secondEmbedderCalls).toHaveLength(0);
  });
});
