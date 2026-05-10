// Public API surface for `@askdb/rag`.
//
// Adapters live behind `./stores/<name>` sub-exports so consumers only
// pay for what they import. The core (`.`) export ships chunker, indexer,
// retriever wiring, and the BYO interfaces.

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
