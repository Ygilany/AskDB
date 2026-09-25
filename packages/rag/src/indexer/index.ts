import type { AskDbLogger, NormalizedSchemaV2 } from "@askdb/core";
import { chunkIdPrefix, chunkSchema, type ChunkResult } from "../chunker/index.js";
import type { ChunkOptions } from "../chunker/options.js";
import type { ChunkerSources } from "../chunker/sources.js";
import { AskDbRagLogEvent } from "../log-events.js";
import type {
  Chunk,
  Embedder,
  Retriever,
  VectorStore,
  VectorStoreDescriptor,
} from "../types.js";
import { chunkContentHash } from "./hash.js";
import {
  SCHEMA_LOCK_VERSION,
  inspectLockFile,
  writeLockFile,
  type LockFileInspection,
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
   * file; if it changes between runs (including going from unset to set or
   * back), all chunks re-embed (model swap is a full invalidation).
   */
  embedderId?: string;
  /**
   * Path to `schema.lock.json`. When set, the lock records the embedder id,
   * store identity, dimensions, and chunk hashes. A missing, unreadable, or
   * older-format lock triggers a full reindex.
   */
  lockFilePath?: string;
  /** Re-embed every chunk, ignoring the lock file and stored hashes. */
  force?: boolean;
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

  // 3. Decide which chunks need (re-)embedding.
  //
  // Stores that can report stored hashes are the source of truth: a chunk is
  // skipped only when the store already holds the same content hash for its
  // id. The lock file only guards embedder identity for them. Stores that
  // cannot report hashes fall back to the lock's hashes, guarded by store
  // identity and dimensions.
  const schemaId = sources.schema.schemaId;
  const idPrefix = chunkIdPrefix(schemaId);
  const descriptor = store.describe?.();
  const lockState: LockFileInspection = lockFilePath
    ? inspectLockFile(lockFilePath)
    : { status: "missing" };
  const previousLock =
    lockState.status === "ok" && lockState.lock.schemaId === schemaId
      ? lockState.lock
      : undefined;
  const storeHashes = store.hashesByPrefix
    ? await store.hashesByPrefix(idPrefix)
    : undefined;
  const fullReindexReason = decideFullReindex({
    force: options.force === true,
    lockFilePath,
    lockState,
    previousLock,
    embedderId,
    descriptor,
    storeReportsHashes: storeHashes !== undefined,
  });
  const embedderChanged = fullReindexReason === "embedder-changed";
  const previousHashes: Record<string, string> =
    storeHashes ?? previousLock?.hashes ?? {};

  const newHashes: Record<string, string> = {};
  const toEmbed: Chunk[] = [];
  let reused = 0;
  for (const c of chunks) {
    const hash = chunkContentHash(c.text);
    newHashes[c.id] = hash;
    if (fullReindexReason === undefined && previousHashes[c.id] === hash) {
      // Same text, same embedder, and (for hash-reporting stores) verified
      // present in the store — keep the stored vector.
      reused++;
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
      ...(fullReindexReason ? { fullReindexReason } : {}),
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
      "rag chunks reused (unchanged and already stored)",
    );
  }

  // 4. Embed in batches and upsert.
  let embeddedCount = 0;
  let observedDimensions: number | undefined;
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const vectors = await embedder(batch.map((c) => c.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedder returned ${vectors.length} vectors for ${batch.length} inputs.`,
      );
    }
    for (const v of vectors) {
      observedDimensions ??= v.length;
      if (v.length !== observedDimensions) {
        throw new Error(
          `Embedder returned vectors of inconsistent dimensions (${observedDimensions} and ${v.length}).`,
        );
      }
    }
    if (
      descriptor?.dimensions !== undefined &&
      observedDimensions !== undefined &&
      observedDimensions !== descriptor.dimensions
    ) {
      throw new Error(
        `Embedder returned ${observedDimensions}-dimension vectors but the ${descriptor.kind} store ` +
          `expects ${descriptor.dimensions}. Configure the store with dimensions=${observedDimensions} ` +
          `(pgvector: a new table or a recreated one), or use an embedder that produces ${descriptor.dimensions}-dimension vectors.`,
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

  // 5. Drop this schema's chunks that no longer exist (artifact pruning).
  // Scoped to this schema: other schemas sharing the store are never touched.
  const currentIds = new Set(chunks.map((c) => c.id));
  const candidates = new Set<string>();
  if (store.idsBySchema) {
    // Exact: matched on payload schemaId (also finds older-format ids).
    for (const id of await store.idsBySchema(schemaId)) candidates.add(id);
  } else {
    // Prefix match; only used when the store can't list ids by schema.
    for (const id of Object.keys(storeHashes ?? {})) candidates.add(id);
  }
  for (const id of Object.keys(previousLock?.hashes ?? {})) {
    if (id.startsWith(idPrefix)) candidates.add(id);
  }
  if (lockState.status === "outdated" && lockState.schemaId === schemaId) {
    // Older-format (unscoped) ids this schema wrote under the previous lock.
    for (const id of Object.keys(lockState.hashes)) candidates.add(id);
  }
  const orphaned = [...candidates].filter((id) => !currentIds.has(id)).sort();
  if (orphaned.length > 0) {
    await store.delete(orphaned);
  }

  // 6. Persist lock file.
  if (lockFilePath) {
    const dimensions =
      observedDimensions ?? descriptor?.dimensions ?? previousLock?.dimensions;
    const lock: SchemaLockFile = {
      version: SCHEMA_LOCK_VERSION,
      schemaId,
      ...(embedderId !== undefined ? { embedderId } : {}),
      ...(dimensions !== undefined ? { dimensions } : {}),
      ...(descriptor ? { store: storeIdentity(descriptor) } : {}),
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

/** Why every chunk is re-embedded this run (`undefined` → incremental). */
type FullReindexReason =
  | "force"
  | "lock-missing"
  | "lock-outdated"
  | "embedder-changed"
  | "dimensions-changed"
  | "store-changed";

function decideFullReindex(args: {
  force: boolean;
  lockFilePath: string | undefined;
  lockState: LockFileInspection;
  previousLock: SchemaLockFile | undefined;
  embedderId: string | undefined;
  descriptor: VectorStoreDescriptor | undefined;
  storeReportsHashes: boolean;
}): FullReindexReason | undefined {
  if (args.force) return "force";
  const lock = args.previousLock;
  if (args.lockFilePath !== undefined) {
    if (args.lockState.status === "outdated") return "lock-outdated";
    // No usable lock → the embedder that produced any stored vectors is
    // unknown, so nothing can be trusted.
    if (!lock) return "lock-missing";
  }
  if (!lock) return undefined;
  // Undefined vs defined counts as a change: we can't prove it's the same model.
  if ((lock.embedderId ?? null) !== (args.embedderId ?? null)) return "embedder-changed";
  if (
    lock.dimensions !== undefined &&
    args.descriptor?.dimensions !== undefined &&
    lock.dimensions !== args.descriptor.dimensions
  ) {
    return "dimensions-changed";
  }
  // The lock's hashes only describe the store they were written to. Stores
  // that report their own hashes don't depend on it.
  if (!args.storeReportsHashes) {
    const current = args.descriptor ? storeIdentity(args.descriptor) : undefined;
    const previous = lock.store;
    if (
      (current?.kind ?? null) !== (previous?.kind ?? null) ||
      (current?.location ?? null) !== (previous?.location ?? null)
    ) {
      return "store-changed";
    }
  }
  return undefined;
}

function storeIdentity(descriptor: VectorStoreDescriptor): { kind: string; location?: string } {
  return descriptor.location !== undefined
    ? { kind: descriptor.kind, location: descriptor.location }
    : { kind: descriptor.kind };
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
  SCHEMA_LOCK_VERSION,
  type SchemaLockFile,
} from "./lock-file.js";
export { chunkContentHash } from "./hash.js";
