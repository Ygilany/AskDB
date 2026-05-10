/**
 * Structured `event` constants for `@askdb/rag` logs. Reused from any
 * `AskDbLogger` implementation — same shape as `@askdb/core` events
 * (Phase 2 logging contract).
 */
export const AskDbRagLogEvent = {
  /** Indexing started (chunk count + reuse intent). */
  IndexingStarted: "askdb.rag.indexing_started",
  /** A single chunk was embedded and upserted. */
  ChunkIndexed: "askdb.rag.chunk_indexed",
  /** Counts of chunks reused from the lock file (no embedding call). */
  ChunksReused: "askdb.rag.chunks_reused",
  /** Indexing finished (totals). */
  IndexingCompleted: "askdb.rag.indexing_completed",
  /** Counts only — describable-layer chunks dropped because the source content references a sensitive column. */
  SensitiveChunksExcluded: "askdb.rag.sensitive_chunks_excluded",
  /** Counts only — opt-in `includeSensitiveDescribable: true` is in effect. */
  SensitiveChunksIncluded: "askdb.rag.sensitive_chunks_included",
  /** Retrieval ran for a question; counts only. */
  RetrievalCompleted: "askdb.rag.retrieval_completed",
} as const;

export type AskDbRagLogEventName =
  (typeof AskDbRagLogEvent)[keyof typeof AskDbRagLogEvent];
