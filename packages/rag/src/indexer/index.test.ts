import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChunkerSourcesFromDir } from "../chunker/index.js";
import { createFileStore } from "../stores/file.js";
import { createMemoryStore, type MemoryStore } from "../stores/memory.js";
import type { Embedder, VectorStore } from "../types.js";
import { buildSchemaIndex, checkIndexMatches, readLockFile } from "./index.js";

const FIXTURE_DIR = resolve(
  __dirname,
  "../../../../fixtures/schemas/orders-users.schema",
);

const tempDirs: string[] = [];

function tempLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-rag-index-"));
  tempDirs.push(dir);
  return join(dir, "schema.lock.json");
}

function deterministicEmbedder(): Embedder {
  return async (texts) =>
    texts.map((text) => [
      text.length,
      Array.from(text).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 997,
    ]);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildSchemaIndex", () => {
  it("indexes all chunks on first run and reuses all unchanged chunks on second run", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());

    const first = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      embedderId: "test:deterministic",
      lockFilePath,
    });
    expect(first.stats.chunksIndexed).toBe(first.stats.chunksTotal);
    expect(first.stats.chunksReused).toBe(0);
    expect(embedder).toHaveBeenCalledTimes(1);

    const second = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      embedderId: "test:deterministic",
      lockFilePath,
    });
    expect(second.stats.chunksIndexed).toBe(0);
    expect(second.stats.chunksReused).toBe(second.stats.chunksTotal);
    expect(embedder).toHaveBeenCalledTimes(1);
  });

  it("re-embeds only chunks whose content hash changed", async () => {
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);

    const first = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      embedderId: "test:deterministic",
      lockFilePath,
    });

    const edited = loadChunkerSourcesFromDir(FIXTURE_DIR);
    edited.tables["table:public.orders"].sections["Business context"] =
      "Orders have a new reporting note.";

    const second = await buildSchemaIndex({
      schema: edited,
      embedder,
      store,
      embedderId: "test:deterministic",
      lockFilePath,
    });

    expect(second.stats.chunksIndexed).toBe(1);
    expect(second.stats.chunksReused).toBe(first.stats.chunksTotal - 1);
  });

  it("writes deterministic lock-file hash ordering", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();

    await buildSchemaIndex({
      schema: sources,
      embedder: deterministicEmbedder(),
      store: lockedMemoryStore(),
      embedderId: "test:deterministic",
      lockFilePath,
    });

    const lock = JSON.parse(readFileSync(lockFilePath, "utf8")) as {
      hashes: Record<string, string>;
    };
    expect(Object.keys(lock.hashes)).toEqual(Object.keys(lock.hashes).sort());
  });

  it("records the width of the vectors it embedded in the lock file, and keeps it when nothing is re-embedded", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const readDimensions = () => (JSON.parse(readFileSync(lockFilePath, "utf8")) as { dimensions?: number }).dimensions;

    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "test:a", lockFilePath });
    expect(readDimensions()).toBe(2);

    const second = await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "test:a", lockFilePath });
    expect(second.stats.chunksIndexed).toBe(0);
    expect(readDimensions()).toBe(2);
  });

  it("can reuse unchanged chunks from store hashes when no lock file is supplied", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());

    const first = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      embedderId: "test:deterministic",
    });
    const second = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      embedderId: "test:deterministic",
    });

    expect(first.stats.chunksIndexed).toBe(first.stats.chunksTotal);
    expect(second.stats.chunksIndexed).toBe(0);
    expect(second.stats.chunksReused).toBe(second.stats.chunksTotal);
    expect(embedder).toHaveBeenCalledTimes(1);
  });

  it("does not put schema identifiers into askdb.rag.* log payloads", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const logger = { info: vi.fn(), error: vi.fn() };

    await buildSchemaIndex({
      schema: sources,
      embedder: deterministicEmbedder(),
      store: lockedMemoryStore(),
      embedderId: "test:deterministic",
      logger,
      chunkOptions: { includeSensitiveDescribable: true },
    });

    for (const [payload] of logger.info.mock.calls) {
      const event = (payload as { event?: string }).event;
      if (!event?.startsWith("askdb.rag.")) continue;
      expect(JSON.stringify(payload)).not.toMatch(/public\.|#email|#status|#total_amount|users|orders/);
    }
  });
});

/**
 * A memory store that doesn't call itself ephemeral, so the indexer reads and
 * writes the lock with it, as with any persistent store.
 */
function lockedMemoryStore(): MemoryStore {
  const store = createMemoryStore();
  return { ...store, describe: () => ({ ...store.describe!(), ephemeral: false }) };
}

/** A store that can't report hashes/ids — forces the lock-file fallback path. */
function lockOnlyStore(
  backing: MemoryStore,
  descriptor?: { kind: string; location?: string; dimensions?: number },
): VectorStore {
  return {
    upsert: backing.upsert,
    query: backing.query,
    delete: backing.delete,
    ...(descriptor ? { describe: () => descriptor } : {}),
  };
}

describe("buildSchemaIndex — store is the source of truth", () => {
  it("re-embeds everything when the lock matches but the store is empty (memory → file switch)", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const embedder = vi.fn(deterministicEmbedder());

    await buildSchemaIndex({
      schema: sources,
      embedder,
      store: lockedMemoryStore(),
      embedderId: "test:deterministic",
      lockFilePath,
    });

    const basePath = join(dirname(lockFilePath), "schema");
    const fileStore = createFileStore({ basePath });
    const second = await buildSchemaIndex({
      schema: sources,
      embedder,
      store: fileStore,
      embedderId: "test:deterministic",
      lockFilePath,
    });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
    expect(second.stats.chunksReused).toBe(0);
    expect(fileStore.size()).toBe(second.stats.chunksTotal);
  });

  it("re-embeds everything into a fresh memory store even with an up-to-date lock (process restart)", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const embedder = vi.fn(deterministicEmbedder());
    const opts = { schema: sources, embedder, embedderId: "test:deterministic", lockFilePath };

    await buildSchemaIndex({ ...opts, store: lockedMemoryStore() });
    const restarted = lockedMemoryStore();
    const second = await buildSchemaIndex({ ...opts, store: restarted });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
    expect(restarted.size()).toBe(second.stats.chunksTotal);
  });

  it("re-embeds the vectors an interrupted embedder switch left behind, though both models have the same width", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const store = lockedMemoryStore();
    const lockFilePath = tempLockPath();
    const modelA = deterministicEmbedder();
    await buildSchemaIndex({ schema: sources, embedder: modelA, store, embedderId: "a", lockFilePath });

    // Model B writes one batch of 4, then fails; the lock still says "a".
    let calls = 0;
    const modelB: Embedder = async (texts) => {
      if (calls++ > 0) throw new Error("rate limited");
      return texts.map(() => [9, 9]);
    };
    await expect(
      buildSchemaIndex({ schema: sources, embedder: modelB, store, embedderId: "b", lockFilePath, batchSize: 4 }),
    ).rejects.toThrow("rate limited");
    // Until a build finishes, a query guard refuses the mixed index.
    const guard = () => checkIndexMatches({ lockFilePath, schemaId: "orders-users", embedderId: "a" });
    expect(guard()).toMatchObject({ ok: false, reason: "index-incomplete" });

    const third = await buildSchemaIndex({ schema: sources, embedder: modelA, store, embedderId: "a", lockFilePath });
    expect(third.stats.chunksIndexed).toBe(4);
    expect(guard()).toMatchObject({ ok: true });
  });

  it("neither reads nor writes the lock for an ephemeral (memory) store", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store: lockedMemoryStore(), embedderId: "file-index", lockFilePath });
    const before = readFileSync(lockFilePath, "utf8");

    const memory = createMemoryStore();
    const first = await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store: memory, embedderId: "studio", lockFilePath });
    expect(readFileSync(lockFilePath, "utf8")).toBe(before);
    expect(first.stats.chunksIndexed).toBe(first.stats.chunksTotal);
    // Still incremental, from the store's own hashes.
    const second = await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store: memory, embedderId: "studio", lockFilePath });
    expect(second.stats.chunksIndexed).toBe(0);
  });

  it("re-embeds only chunks the store is missing", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());
    const opts = { schema: sources, embedder, store, embedderId: "test:deterministic", lockFilePath };

    const first = await buildSchemaIndex(opts);
    await store.delete([first.chunks[0].id]);
    const second = await buildSchemaIndex(opts);
    expect(second.stats.chunksIndexed).toBe(1);
    expect(second.stats.chunksReused).toBe(first.stats.chunksTotal - 1);
  });

  it("`force: true` re-embeds everything", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());
    const opts = { schema: sources, embedder, store, embedderId: "test:deterministic", lockFilePath };

    await buildSchemaIndex(opts);
    const forced = await buildSchemaIndex({ ...opts, force: true });
    expect(forced.stats.chunksIndexed).toBe(forced.stats.chunksTotal);
    expect(forced.stats.chunksReused).toBe(0);
  });

  it("treats a missing-vs-present embedderId as an embedder change", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());

    await buildSchemaIndex({ schema: sources, embedder, store, lockFilePath });
    const second = await buildSchemaIndex({
      schema: sources,
      embedder,
      store,
      lockFilePath,
      embedderId: "test:deterministic",
    });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);

    const third = await buildSchemaIndex({ schema: sources, embedder, store, lockFilePath });
    expect(third.stats.chunksIndexed).toBe(third.stats.chunksTotal);
  });

  it("re-embeds everything when the lock file is missing but the store has data", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const store = lockedMemoryStore();
    const embedder = vi.fn(deterministicEmbedder());
    const opts = { schema: sources, embedder, store, embedderId: "test:deterministic" };

    await buildSchemaIndex({ ...opts, lockFilePath: tempLockPath() });
    const second = await buildSchemaIndex({ ...opts, lockFilePath: tempLockPath() });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
  });

  it("records embedder, store identity, and dimensions in the lock", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const basePath = join(dirname(lockFilePath), "schema");
    await buildSchemaIndex({
      schema: sources,
      embedder: deterministicEmbedder(),
      store: createFileStore({ basePath }),
      embedderId: "test:deterministic",
      lockFilePath,
    });
    const lock = readLockFile(lockFilePath);
    expect(lock).toMatchObject({
      version: 2,
      schemaId: "orders-users",
      embedderId: "test:deterministic",
      dimensions: 2,
      store: { kind: "file" },
    });
    // The lock is committed: it must not carry this machine's paths.
    expect(readFileSync(lockFilePath, "utf8")).not.toContain(dirname(lockFilePath));
    expect(Object.keys(lock!.hashes).every((id) => id.startsWith("chunk:orders-users:"))).toBe(true);
  });

  it("throws a clear error when the embedder's dimensions don't match the store", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const store: VectorStore = {
      ...lockedMemoryStore(),
      describe: () => ({ kind: "qdrant", location: "t", dimensions: 3 }),
    };
    const error = await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store }).catch(
      (e: unknown) => e as Error,
    );
    // Generic: no advice that only fits a built-in store.
    expect(error.message).toBe(
      "Embedder returned 2-dimension vectors but the qdrant store is set up for 3. Use a store set up for 2, " +
        "or an embedder that produces 3-dimension vectors.",
    );
  });

  it("tells a file-store user to delete the embeddings files when the width changes", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const dir = mkdtempSync(join(tmpdir(), "askdb-rag-width-"));
    tempDirs.push(dir);
    const basePath = join(dir, "schema");
    const lockFilePath = join(dir, "schema.lock.json");
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store: createFileStore({ basePath }), embedderId: "w2", lockFilePath });

    const threeDims: Embedder = async (texts) => texts.map((t) => [t.length, 1, 2]);
    await expect(
      buildSchemaIndex({ schema: sources, embedder: threeDims, store: createFileStore({ basePath }), embedderId: "w3", lockFilePath }),
    ).rejects.toThrow(`file store is set up for 2. Use a store set up for 3, or an embedder that produces 2-dimension vectors. Delete ${basePath}.embeddings.bin and ${basePath}.embeddings.json to rebuild the index at the new width.`);
  });

  it("reports a changed embedder even when another reason forces the full reindex", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockedMemoryStore();
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "a", lockFilePath });

    const logger = { info: vi.fn(), error: vi.fn() };
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "b", lockFilePath, force: true, logger });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "askdb.rag.indexing_started", embedderChanged: true, fullReindexReason: "force" }),
      expect.any(String),
    );
  });
});

describe("buildSchemaIndex — lock-file fallback for stores without hashesByPrefix", () => {
  it("reuses chunks when store identity, dimensions, and embedder match", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const backing = lockedMemoryStore();
    const store = lockOnlyStore(backing, { kind: "custom", location: "a" });
    const opts = { schema: sources, embedder: deterministicEmbedder(), store, embedderId: "e", lockFilePath };

    await buildSchemaIndex(opts);
    const second = await buildSchemaIndex(opts);
    expect(second.stats.chunksIndexed).toBe(0);
    expect(second.stats.chunksReused).toBe(second.stats.chunksTotal);
  });

  it("re-embeds everything when the store identity changed", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const opts = { schema: sources, embedder: deterministicEmbedder(), embedderId: "e", lockFilePath };

    await buildSchemaIndex({
      ...opts,
      store: lockOnlyStore(lockedMemoryStore(), { kind: "custom", location: "a" }),
    });
    const second = await buildSchemaIndex({
      ...opts,
      store: lockOnlyStore(lockedMemoryStore(), { kind: "custom", location: "b" }),
    });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
  });

  it("re-embeds everything when the store's dimensions changed", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const opts = { schema: sources, embedderId: "e", lockFilePath };

    await buildSchemaIndex({
      ...opts,
      embedder: deterministicEmbedder(),
      store: lockOnlyStore(lockedMemoryStore(), { kind: "custom", dimensions: 2 }),
    });
    const threeDims: Embedder = async (texts) => texts.map((t) => [t.length, 1, 2]);
    const second = await buildSchemaIndex({
      ...opts,
      embedder: threeDims,
      store: lockOnlyStore(lockedMemoryStore(), { kind: "custom", dimensions: 3 }),
    });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
    expect(readLockFile(lockFilePath)?.dimensions).toBe(3);
  });

  it("re-embeds everything after an interrupted embedder switch, when the store can't report hashes", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const store = lockOnlyStore(createMemoryStore(), { kind: "custom" });
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "a", lockFilePath });
    let calls = 0;
    const failing: Embedder = async (texts) => {
      if (calls++ > 0) throw new Error("rate limited");
      return texts.map(() => [9, 9]);
    };
    await expect(
      buildSchemaIndex({ schema: sources, embedder: failing, store, embedderId: "b", lockFilePath, batchSize: 4 }),
    ).rejects.toThrow("rate limited");

    const third = await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "a", lockFilePath });
    expect(third.stats.chunksIndexed).toBe(third.stats.chunksTotal);
  });

  it("re-embeds everything into a store that can't identify itself, even a fresh, empty one", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const opts = { schema: sources, embedder: deterministicEmbedder(), embedderId: "e", lockFilePath };

    await buildSchemaIndex({ ...opts, store: lockOnlyStore(lockedMemoryStore()) });
    const fresh = lockedMemoryStore();
    const second = await buildSchemaIndex({ ...opts, store: lockOnlyStore(fresh) });
    expect(second.stats.chunksIndexed).toBe(second.stats.chunksTotal);
    expect(fresh.size()).toBe(second.stats.chunksTotal);
  });
});

describe("buildSchemaIndex — schema-scoped ids and orphan cleanup", () => {
  it("indexing one schema never deletes another schema's chunks in a shared store", async () => {
    const store = lockedMemoryStore();
    const embedder = deterministicEmbedder();
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "orders-users-b";

    const indexA = await buildSchemaIndex({ schema: a, embedder, store, embedderId: "e", lockFilePath: tempLockPath() });
    const indexB = await buildSchemaIndex({ schema: b, embedder, store, embedderId: "e", lockFilePath: tempLockPath() });
    expect(store.size()).toBe(indexA.stats.chunksTotal + indexB.stats.chunksTotal);

    // Drop a table from schema A and reindex: only A's chunks for it go away.
    const aLockPath = tempLockPath();
    const shrunk = loadChunkerSourcesFromDir(FIXTURE_DIR);
    shrunk.schema.tables = shrunk.schema.tables.filter((t) => t.id !== "table:public.orders");
    delete shrunk.tables["table:public.orders"];
    shrunk.concepts = undefined;
    const reindexedA = await buildSchemaIndex({ schema: shrunk, embedder, store, embedderId: "e", lockFilePath: aLockPath });

    const bIds = await store.idsBySchema!("orders-users-b");
    expect(bIds.sort()).toEqual(indexB.chunks.map((c) => c.id).sort());
    const aIds = await store.idsBySchema!("orders-users");
    expect(aIds.sort()).toEqual(reindexedA.chunks.map((c) => c.id).sort());
    expect(aIds.some((id) => id.includes("public.orders"))).toBe(false);
  });

  it("does not treat a schema whose id extends another's as its orphans", async () => {
    const store = lockedMemoryStore();
    const embedder = deterministicEmbedder();
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    a.schema.schemaId = "shop";
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "shop:eu"; // extends `shop`'s id
    await buildSchemaIndex({ schema: a, embedder, store, embedderId: "e" });
    const indexB = await buildSchemaIndex({ schema: b, embedder, store, embedderId: "e" });
    await buildSchemaIndex({ schema: a, embedder, store, embedderId: "e" });
    expect(await store.idsBySchema!("shop:eu")).toHaveLength(indexB.stats.chunksTotal);
  });

  it("never prunes another schema's chunks from a store that reports hashes but can't list ids by schema", async () => {
    const backing = lockedMemoryStore();
    const store: VectorStore = { ...lockOnlyStore(backing), hashesByPrefix: backing.hashesByPrefix };
    const embedder = deterministicEmbedder();
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    a.schema.schemaId = "shop";
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "shop:eu"; // extends `shop`'s id
    const lockA = tempLockPath();

    await buildSchemaIndex({ schema: a, embedder, store, embedderId: "e", lockFilePath: lockA });
    const indexB = await buildSchemaIndex({ schema: b, embedder, store, embedderId: "e", lockFilePath: tempLockPath() });
    // Reindex `shop` with a table removed, with and without its lock.
    const shrunk = loadChunkerSourcesFromDir(FIXTURE_DIR);
    shrunk.schema.schemaId = "shop";
    shrunk.concepts = undefined;
    const reindexedA = await buildSchemaIndex({ schema: shrunk, embedder, store, embedderId: "e", lockFilePath: lockA });
    const logger = { info: vi.fn(), error: vi.fn() };
    await buildSchemaIndex({ schema: shrunk, embedder, store, embedderId: "e", logger });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "askdb.rag.orphan_cleanup_limited" }),
      expect.any(String),
    );
    expect((await backing.idsBySchema!("shop:eu")).sort()).toEqual(indexB.chunks.map((c) => c.id).sort());
    // `shop`'s own orphans (listed in its lock) are still pruned.
    expect((await backing.idsBySchema!("shop")).sort()).toEqual(reindexedA.chunks.map((c) => c.id).sort());
  });

  it("never prunes another schema's old-format ids that share this schema's prefix, from a store that can't list ids by schema", async () => {
    const backing = lockedMemoryStore();
    const store: VectorStore = { ...lockOnlyStore(backing), hashesByPrefix: backing.hashesByPrefix };
    // An older, unscoped id another schema wrote: it starts with `chunk:table:`,
    // which is also the prefix of a schema named `table`.
    const legacyId = "chunk:table:public.legacy";
    await backing.upsert([
      {
        id: legacyId,
        vector: [1, 1],
        hash: "h",
        payload: { id: legacyId, type: "table", text: "legacy", schemaId: "other", refs: [], sensitive: false },
      },
    ]);
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    sources.schema.schemaId = "table";

    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "e", lockFilePath: tempLockPath() });
    await buildSchemaIndex({ schema: sources, embedder: deterministicEmbedder(), store, embedderId: "e" });
    expect(await backing.idsBySchema!("other")).toEqual([legacyId]);
  });

  it("deletes none of another schema's chunks on the word of a lock copied from its directory, and logs it", async () => {
    const store = lockedMemoryStore();
    const lockFilePath = tempLockPath();
    const shop = loadChunkerSourcesFromDir(FIXTURE_DIR);
    shop.schema.schemaId = "shop";
    const indexedShop = await buildSchemaIndex({ schema: shop, embedder: deterministicEmbedder(), store, embedderId: "e", lockFilePath });

    // `shop.schema/` copied to `shop-eu.schema/` with its lock, schemaId edited.
    const shopEu = loadChunkerSourcesFromDir(FIXTURE_DIR);
    shopEu.schema.schemaId = "shop-eu";
    const logger = { info: vi.fn(), error: vi.fn() };
    await buildSchemaIndex({ schema: shopEu, embedder: deterministicEmbedder(), store, embedderId: "e", lockFilePath, logger });

    expect(await store.idsBySchema!("shop")).toHaveLength(indexedShop.stats.chunksTotal);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "askdb.rag.lock_schema_mismatch", lockSchemaId: "shop", schemaId: "shop-eu" }),
      expect.any(String),
    );
  });

  it("deletes nothing on the word of a lock from a newer @askdb/rag", async () => {
    const store = lockedMemoryStore();
    const otherId = "chunk:other:table:public.kept";
    await store.upsert([
      {
        id: otherId,
        vector: [1, 1],
        payload: { id: otherId, type: "table", text: "kept", schemaId: "other", refs: [], sensitive: false },
      },
    ]);
    const lockFilePath = tempLockPath();
    writeFileSync(lockFilePath, JSON.stringify({ version: 99, schemaId: "orders-users", hashes: { [otherId]: "h" } }));

    const result = await buildSchemaIndex({ schema: loadChunkerSourcesFromDir(FIXTURE_DIR), embedder: deterministicEmbedder(), store, embedderId: "e", lockFilePath });
    expect(result.stats.chunksIndexed).toBe(result.stats.chunksTotal);
    expect(await store.idsBySchema!("other")).toEqual([otherId]);
    expect(readLockFile(lockFilePath)?.version).toBe(2);
  });

  it("prunes orphans via the lock for stores that can't list ids, scoped to the schema", async () => {
    const backing = lockedMemoryStore();
    const store = lockOnlyStore(backing, { kind: "custom" });
    const embedder = deterministicEmbedder();
    const lockA = tempLockPath();
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "orders-users-b";

    await buildSchemaIndex({ schema: a, embedder, store, embedderId: "e", lockFilePath: lockA });
    const indexB = await buildSchemaIndex({ schema: b, embedder, store, embedderId: "e", lockFilePath: tempLockPath() });

    const shrunk = loadChunkerSourcesFromDir(FIXTURE_DIR);
    shrunk.concepts = undefined;
    const reindexedA = await buildSchemaIndex({ schema: shrunk, embedder, store, embedderId: "e", lockFilePath: lockA });

    expect((await backing.idsBySchema!("orders-users")).sort()).toEqual(
      reindexedA.chunks.map((c) => c.id).sort(),
    );
    expect(await backing.idsBySchema!("orders-users-b")).toHaveLength(indexB.stats.chunksTotal);
  });

  it("an older-format lock triggers a full reindex and removes that schema's unscoped ids", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const lockFilePath = tempLockPath();
    const backing = lockedMemoryStore();
    // Simulate an index written by the previous version: unscoped ids + v1 lock.
    const legacyIds = ["chunk:table:public.orders", "chunk:table:public.users"];
    await backing.upsert(
      legacyIds.map((id) => ({
        id,
        vector: [1, 1],
        hash: "h",
        payload: { id, type: "table", text: id, schemaId: "orders-users", refs: [], sensitive: false },
      })),
    );
    writeFileSync(
      lockFilePath,
      JSON.stringify({
        version: 1,
        schemaId: "orders-users",
        embedderId: "e",
        hashes: Object.fromEntries(legacyIds.map((id) => [id, "h"])),
      }),
    );
    // Lock-only store: legacy ids must be found via the v1 lock itself.
    const store = lockOnlyStore(backing, { kind: "custom" });

    const result = await buildSchemaIndex({
      schema: sources,
      embedder: deterministicEmbedder(),
      store,
      embedderId: "e",
      lockFilePath,
    });
    expect(result.stats.chunksIndexed).toBe(result.stats.chunksTotal);
    const ids = await backing.idsBySchema!("orders-users");
    for (const legacy of legacyIds) expect(ids).not.toContain(legacy);
    expect(readLockFile(lockFilePath)?.version).toBe(2);
  });
});
