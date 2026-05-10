import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChunkerSourcesFromDir } from "../chunker/index.js";
import { createMemoryStore } from "../stores/memory.js";
import type { Embedder } from "../types.js";
import { buildSchemaIndex } from "./index.js";

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
    const store = createMemoryStore();
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
    const store = createMemoryStore();
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
      store: createMemoryStore(),
      embedderId: "test:deterministic",
      lockFilePath,
    });

    const lock = JSON.parse(readFileSync(lockFilePath, "utf8")) as {
      hashes: Record<string, string>;
    };
    expect(Object.keys(lock.hashes)).toEqual(Object.keys(lock.hashes).sort());
  });

  it("can reuse unchanged chunks from store hashes when no lock file is supplied", async () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const store = createMemoryStore();
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
      store: createMemoryStore(),
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
