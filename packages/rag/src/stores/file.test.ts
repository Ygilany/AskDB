import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  it("writes via temp files and leaves none behind", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([{ id: "orders", vector: [1, 0], payload: payload("orders") }]);
    await store.delete(["orders"]);
    await store.upsert([{ id: "users", vector: [0, 1], payload: payload("users") }]);

    expect(readdirSync(dirname(basePath)).sort()).toEqual([
      "schema.embeddings.bin",
      "schema.embeddings.json",
    ]);
    const meta = JSON.parse(readFileSync(`${basePath}.embeddings.json`, "utf8")) as {
      binSha256?: string;
    };
    expect(meta.binSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects a crash between the two renames and asks for a reindex", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([{ id: "orders", vector: [1, 0], payload: payload("orders") }]);
    const staleMeta = readFileSync(`${basePath}.embeddings.json`, "utf8");

    // Second flush: the .bin (renamed first) is new; pretend the process died
    // before the .json rename by restoring the previous .json.
    await store.upsert([{ id: "orders", vector: [0, 1], payload: payload("orders") }]);
    writeFileSync(`${basePath}.embeddings.json`, staleMeta);

    expect(() => createFileStore({ basePath })).toThrow(
      /does not match the checksum.*rebuild the index/s,
    );
  });

  it("gives a reindex hint on a vector/record count mismatch", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([
      { id: "orders", vector: [1, 0], payload: payload("orders") },
      { id: "users", vector: [0, 1], payload: payload("users") },
    ]);
    // Legacy JSON (no checksum) paired with a .bin holding a different count.
    const meta = JSON.parse(readFileSync(`${basePath}.embeddings.json`, "utf8")) as {
      binSha256?: string;
      records: unknown[];
    };
    delete meta.binSha256;
    meta.records = meta.records.slice(0, 1);
    writeFileSync(`${basePath}.embeddings.json`, JSON.stringify(meta));

    expect(() => createFileStore({ basePath })).toThrow(
      /has 2 vectors but .* has 1 records.*rebuild the index/s,
    );
  });

  it("errors when only one of the two files exists", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([{ id: "orders", vector: [1, 0], payload: payload("orders") }]);
    rmSync(`${basePath}.embeddings.json`);
    expect(() => createFileStore({ basePath })).toThrow(/File-store incomplete/);
  });

  it("surfaces write failures and cleans up its temp files", async () => {
    const basePath = tempBasePath();
    const store = createFileStore({ basePath });
    await store.upsert([{ id: "orders", vector: [1, 0], payload: payload("orders") }]);

    // A non-empty directory at the .json path makes the final rename fail.
    rmSync(`${basePath}.embeddings.json`);
    mkdirSync(`${basePath}.embeddings.json`);
    writeFileSync(join(`${basePath}.embeddings.json`, "keep"), "x");
    await expect(
      store.upsert([{ id: "users", vector: [0, 1], payload: payload("users") }]),
    ).rejects.toThrow();
    expect(readdirSync(dirname(basePath)).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });
});
