import type { AskDbLogger, NormalizedSchemaV2 } from "@askdb/core";
import { chunkSchema, type ChunkResult } from "../chunker/index.js";
import type { ChunkOptions } from "../chunker/options.js";
import type { ChunkerSources } from "../chunker/sources.js";
import { AskDbRagLogEvent } from "../log-events.js";
import type { Chunk, Embedder, Retriever, VectorStore } from "../types.js";
import { chunkContentHash } from "./hash.js";
import {
  readLockFile,
  writeLockFile,
  type SchemaLockFile,
} from "./lock-file.js";

/** Optional progress event surfaced via `onProgress`. */
export type IndexProgressEvent =
  | { kind: "started"; totalChunks: number; toEmbed: number; reused: number }
  | { kind: "embedded"; embedded: number; total: number }
  | { kind: "completed"; embedded: number; reused: number };

export type BuildSchemaIndexOptions = {
  /**
   * Spec-compatible input. Pass `loadChunkerSourcesFromDir(...)` for full
   * markdown-section chunking, or a `loadSchema(...)` result when raw table
   * markdown is not available.
   */
  schema?: ChunkerSources | NormalizedSchemaV2;
  /** Backwards-compatible alias for `schema` when callers already loaded raw sources. */
  sources?: ChunkerSources;
  embedder: Embedder;
  store: VectorStore;
  /**
   * Embedder id (e.g. `"openai:text-embedding-3-small"`). Stored in the lock
   * file; if it changes between runs, all chunks re-embed (model swap is a
   * full invalidation).
   */
  embedderId?: string;
  /** Path to `schema.lock.json`. When set, used for skip-reembed bookkeeping. */
  lockFilePath?: string;
  chunkOptions?: ChunkOptions;
  /** Batch size for embedder calls. Default 64 — most providers cap around 100. */
  batchSize?: number;
  logger?: AskDbLogger;
  correlationId?: string;
  onProgress?: (e: IndexProgressEvent) => void;
};

export type BuildSchemaIndexResult = {
  retriever: Retriever;
  stats: {
    chunksTotal: number;
    chunksIndexed: number;
    chunksReused: number;
    sensitiveExcluded: number;
    sensitiveIncluded: number;
  };
  /** Final chunk list (sorted by id). */
  chunks: Chunk[];
};

const DEFAULT_BATCH_SIZE = 64;

export async function buildSchemaIndex(
  options: BuildSchemaIndexOptions,
): Promise<BuildSchemaIndexResult> {
  const {
    embedder,
    store,
    embedderId,
    lockFilePath,
    chunkOptions,
    batchSize = DEFAULT_BATCH_SIZE,
    logger,
    correlationId,
    onProgress,
  } = options;
  const sources = normalizeIndexSources(options);

  const baseLogContext: Record<string, unknown> = correlationId
    ? { correlationId }
    : {};

  // 1. Chunk
  const chunkResult: ChunkResult = chunkSchema(sources, chunkOptions);
  const chunks = chunkResult.chunks;

  // 2. Sensitive log emit (counts only)
  if (chunkResult.stats.sensitiveExcluded > 0) {
    logger?.info(
      {
        ...baseLogContext,
        event: AskDbRagLogEvent.SensitiveChunksExcluded,
        count: chunkResult.stats.sensitiveExcluded,
      },
      "sensitive describable-layer chunks excluded",
    );
  }
  if (
    chunkOptions?.includeSensitiveDescribable === true &&
    chunkResult.stats.sensitiveIncluded > 0
  ) {
    logger?.info(
      {
        ...baseLogContext,
        event: AskDbRagLogEvent.SensitiveChunksIncluded,
        count: chunkResult.stats.sensitiveIncluded,
      },
      "sensitive describable-layer chunks INCLUDED (opt-in)",
    );
  }

  // 3. Decide which chunks need (re-)embedding via lock-file/store hashes.
  const previousLock = lockFilePath ? readLockFile(lockFilePath) : undefined;
  const storeHashes = (await store.hashesByPrefix?.("chunk:")) ?? {};
  const previousHashes = { ...storeHashes, ...(previousLock?.hashes ?? {}) };
  const previousEmbedderId = previousLock?.embedderId;
  const embedderChanged =
    embedderId !== undefined &&
    previousEmbedderId !== undefined &&
    embedderId !== previousEmbedderId;

  const newHashes: Record<string, string> = {};
  const toEmbed: Chunk[] = [];
  let reused = 0;
  for (const c of chunks) {
    const hash = chunkContentHash(c.text);
    newHashes[c.id] = hash;
    if (!embedderChanged && previousHashes[c.id] === hash) {
      reused++;
      // Chunk text unchanged AND embedder unchanged — assume the store still
      // holds the embedding from a prior run. The retriever uses store.query
      // directly so we don't need to round-trip the vector.
      continue;
    }
    toEmbed.push(c);
  }

  logger?.info(
    {
      ...baseLogContext,
      event: AskDbRagLogEvent.IndexingStarted,
      totalChunks: chunks.length,
      toEmbed: toEmbed.length,
      reused,
      embedderChanged,
    },
    "rag indexing started",
  );
  onProgress?.({
    kind: "started",
    totalChunks: chunks.length,
    toEmbed: toEmbed.length,
    reused,
  });

  if (reused > 0) {
    logger?.info(
      {
        ...baseLogContext,
        event: AskDbRagLogEvent.ChunksReused,
        count: reused,
      },
      "rag chunks reused from lock file",
    );
  }

  // 4. Embed in batches and upsert.
  let embeddedCount = 0;
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const vectors = await embedder(batch.map((c) => c.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedder returned ${vectors.length} vectors for ${batch.length} inputs.`,
      );
    }
    await store.upsert(
      batch.map((c, idx) => ({
        id: c.id,
        vector: vectors[idx],
        hash: newHashes[c.id],
        payload: {
          id: c.id,
          type: c.type,
          text: c.text,
          schemaId: c.schemaId,
          refs: c.refs,
          sensitive: c.sensitive,
        },
      })),
    );
    embeddedCount += batch.length;
    for (const c of batch) {
      logger?.info(
        {
          ...baseLogContext,
          event: AskDbRagLogEvent.ChunkIndexed,
          chunkType: c.type,
          textChars: c.text.length,
        },
        "rag chunk indexed",
      );
    }
    onProgress?.({
      kind: "embedded",
      embedded: embeddedCount,
      total: toEmbed.length,
    });
  }

  // 5. Drop chunks present in the previous lock but absent now (artifact pruning).
  const previousIds = new Set(Object.keys(previousHashes));
  const currentIds = new Set(chunks.map((c) => c.id));
  const orphaned: string[] = [];
  for (const id of previousIds) {
    if (!currentIds.has(id)) orphaned.push(id);
  }
  if (orphaned.length > 0) {
    await store.delete(orphaned);
  }

  // 6. Persist lock file.
  if (lockFilePath) {
    const lock: SchemaLockFile = {
      version: 1,
      schemaId: sources.schema.schemaId,
      embedderId,
      hashes: newHashes,
      updatedAt: new Date().toISOString(),
    };
    writeLockFile(lockFilePath, lock);
  }

  logger?.info(
    {
      ...baseLogContext,
      event: AskDbRagLogEvent.IndexingCompleted,
      embedded: embeddedCount,
      reused,
      total: chunks.length,
    },
    "rag indexing completed",
  );
  onProgress?.({ kind: "completed", embedded: embeddedCount, reused });

  // 7. Build retriever bound to the same embedder + store.
  const retriever: Retriever = async ({ question, k = 8, filter }) => {
    const [vector] = await embedder([question]);
    const results = await store.query(vector, k, filter);
    logger?.info(
      {
        ...baseLogContext,
        event: AskDbRagLogEvent.RetrievalCompleted,
        questionChars: question.length,
        k,
        resultCount: results.length,
      },
      "rag retrieval completed",
    );
    return results;
  };

  return {
    retriever,
    stats: {
      chunksTotal: chunks.length,
      chunksIndexed: embeddedCount,
      chunksReused: reused,
      sensitiveExcluded: chunkResult.stats.sensitiveExcluded,
      sensitiveIncluded: chunkResult.stats.sensitiveIncluded,
    },
    chunks,
  };
}

function normalizeIndexSources(options: BuildSchemaIndexOptions): ChunkerSources {
  const input = options.schema ?? options.sources;
  if (!input) {
    throw new Error("buildSchemaIndex requires `schema` (or legacy `sources`).");
  }
  if ("schema" in input && "tables" in input) return input;
  return { schema: input, tables: {} };
}

/**
 * Build a `Retriever` bound to an existing store + embedder, **without**
 * indexing. Useful when the store is already populated by another process
 * (CI, an external pgvector instance, etc.).
 */
export function createRetriever(args: {
  embedder: Embedder;
  store: VectorStore;
  logger?: AskDbLogger;
  correlationId?: string;
}): Retriever {
  return async ({ question, k = 8, filter }) => {
    const [vector] = await args.embedder([question]);
    const results = await args.store.query(vector, k, filter);
    args.logger?.info(
      {
        ...(args.correlationId ? { correlationId: args.correlationId } : {}),
        event: AskDbRagLogEvent.RetrievalCompleted,
        questionChars: question.length,
        k,
        resultCount: results.length,
      },
      "rag retrieval completed",
    );
    return results;
  };
}

export {
  readLockFile,
  writeLockFile,
  type SchemaLockFile,
} from "./lock-file.js";
export { chunkContentHash } from "./hash.js";
