// Public API surface for `@askdb/rag`.
//
// All adapters (stores, embedders) are re-exported here for convenience so
// consumers can import everything from `@askdb/rag`. Sub-path exports
// (`@askdb/rag/stores/memory`, `@askdb/rag/embedders/ai-sdk`, etc.) remain
// available and point to the same modules — use whichever style you prefer.

export type {
  Chunk,
  ChunkPayload,
  ChunkType,
  Filter,
  QueryResult,
  UpsertRecord,
  Embedder,
  VectorStore,
  Retriever,
} from "./types.js";

export {
  chunkSchema,
  chunkSchemaDir,
  chunkSchemaBundle,
  loadChunkerSourcesFromDir,
  loadChunkerSourcesFromBundleJson,
  DEFAULT_CHUNK_MAX_CHARS,
  type ChunkOptions,
  type ChunkResult,
  type ChunkStats,
  type ChunkerSources,
} from "./chunker/index.js";

export {
  buildSchemaIndex,
  createRetriever,
  chunkContentHash,
  readLockFile,
  writeLockFile,
  type BuildSchemaIndexOptions,
  type BuildSchemaIndexResult,
  type IndexProgressEvent,
  type SchemaLockFile,
} from "./indexer/index.js";

// Re-export the synthesis helper from core so consumers can import it from
// `@askdb/rag` without reaching across packages. The function lives in core
// because `ask()` calls it internally when a retriever is supplied.
export { synthesizeRetrievedDdl } from "@askdb/core";

export { AskDbRagLogEvent, type AskDbRagLogEventName } from "./log-events.js";

// Stores
export { createMemoryStore, type MemoryStore } from "./stores/memory.js";
export { createFileStore, type FileStore, type FileStoreOptions } from "./stores/file.js";
export {
  createPgvectorStore,
  type PgvectorStore,
  type PgClient,
  type PgvectorIndexStrategy,
  type CreatePgvectorStoreOptions,
} from "./stores/pgvector.js";

// Embedders
export {
  createAiSdkEmbedder,
  type CreateAiSdkEmbedderOptions,
  type AiSdkEmbedderUsage,
} from "./embedders/ai-sdk.js";
export { createOpenAiEmbedder, type CreateOpenAiEmbedderOptions } from "./embedders/openai.js";
