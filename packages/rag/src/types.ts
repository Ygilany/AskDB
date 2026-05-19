/**
 * Public types for @askdb/rag.
 *
 * The chunker, indexer, and stores all converge on these shapes; nothing else
 * leaks across the package boundary. Embedder and VectorStore are BYO seams —
 * consumers wire their own providers behind these interfaces.
 */

/** Chunk type taxonomy from `docs/contracts/schema-v2.md` (Chunking rules). */
export type ChunkType =
  | "table"
  | "column"
  | "cql"
  | "question"
  | "concept"
  | "relationship"
  | "tenant-policy";

/**
 * One slice of the v2 artifact, embedded as a single vector.
 *
 * `text` is what gets embedded. `id` is stable across runs (re-embedding is
 * gated on text changes via `schema.lock.json`).
 */
export type Chunk = {
  id: string;
  type: ChunkType;
  text: string;
  schemaId: string;
  /** Schema-v2 ids referenced by this chunk (for cross-link filtering). */
  refs: string[];
  /**
   * True when the chunk's source content references a sensitive column.
   * Default chunker excludes such chunks; this metadata flows through anyway
   * so opt-in mode (`includeSensitiveDescribable: true`) can carry it for telemetry.
   */
  sensitive: boolean;
};

/** Payload stored in vector stores alongside the embedding. */
export type ChunkPayload = {
  id: string;
  type: ChunkType;
  text: string;
  schemaId: string;
  refs: string[];
  sensitive: boolean;
};

/** Filter for vector-store queries. Every field is optional. */
export type Filter = {
  schemaId?: string;
  types?: ChunkType[];
  refs?: string[];
};

/** Result of a vector-store similarity query. */
export type QueryResult = {
  id: string;
  score: number;
  payload: ChunkPayload;
};

/** Single record passed to {@link VectorStore.upsert}. */
export type UpsertRecord = {
  id: string;
  vector: number[];
  payload: ChunkPayload;
  /** Optional content hash. Stores may persist it for `hashesByPrefix` reuse. */
  hash?: string;
};

/**
 * BYO embedder seam.
 *
 * Implementations batch as they like; callers pass whatever they want
 * embedded together. No model-specific concerns leak across this seam.
 */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/**
 * BYO vector-store seam.
 *
 * Adapters: in-memory (default), file-backed, pgvector. Adding more is a
 * pure adapter concern — nothing else in the package needs to know.
 */
export type VectorStore = {
  upsert(records: UpsertRecord[]): Promise<void>;
  query(vector: number[], k: number, filter?: Filter): Promise<QueryResult[]>;
  delete(ids: string[]): Promise<void>;
  /**
   * Optional fast path used by the indexer to skip re-embedding unchanged
   * chunks. Returns `chunkId → contentHash` for ids whose stored hash starts
   * with `prefix`. Implementations without persistent hash storage can omit it.
   */
  hashesByPrefix?(prefix: string): Promise<Record<string, string>>;
};

/** Retriever shape consumed by `@askdb/core` `ask({ retriever })`. */
export type Retriever = (params: {
  question: string;
  k?: number;
  filter?: Filter;
}) => Promise<QueryResult[]>;
