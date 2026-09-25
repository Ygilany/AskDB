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
 * `text` is what gets embedded. `id` is stable across runs and scoped to the
 * schema (`chunk:<schemaId>:<local-id>`, e.g.
 * `chunk:orders-users:table:public.orders`) so several schemas can share one
 * vector store without overwriting each other. Re-embedding is gated on the
 * chunk's content hash as reported by the store (or `schema.lock.json` for
 * stores that cannot report hashes).
 */
export type Chunk = {
  id: string;
  type: ChunkType;
  text: string;
  schemaId: string;
  /** Schema-v2 ids referenced by this chunk (for cross-link filtering). */
  refs: string[];
  /**
   * True when the chunk carries describable content that references a
   * sensitive column/table. The default chunker drops that content (or the
   * whole chunk), so this is only `true` in opt-in mode
   * (`includeSensitiveDescribable: true`) — it flows through for telemetry.
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
 * Identity of a vector store, recorded in `schema.lock.json` so the indexer
 * can tell when the lock was written against a different store.
 */
export type VectorStoreDescriptor = {
  /** Adapter kind, e.g. `"memory"`, `"file"`, `"pgvector"`. */
  kind: string;
  /**
   * Where the vectors live, e.g. the file store's resolved `basePath` or the
   * pgvector table name. Never include credentials.
   */
  location?: string;
  /** Vector dimensions the store holds/expects, when known. */
  dimensions?: number;
};

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
   * Returns `chunkId → contentHash` for stored ids that start with `prefix`
   * (records stored without a hash are omitted).
   *
   * When implemented, the indexer treats the store as the source of truth:
   * a chunk is skipped only if the store reports the same content hash for
   * its id. Stores that omit it fall back to `schema.lock.json` bookkeeping
   * (guarded by {@link VectorStore.describe} identity and dimensions).
   */
  hashesByPrefix?(prefix: string): Promise<Record<string, string>>;
  /**
   * Optional: every stored id whose payload `schemaId` matches. Lets the
   * indexer prune orphaned chunks for one schema (including ids written in
   * an older id format) without touching other schemas sharing the store.
   */
  idsBySchema?(schemaId: string): Promise<string[]>;
  /** Optional: store identity recorded in the lock file. */
  describe?(): VectorStoreDescriptor;
};

/** Retriever shape consumed by `@askdb/core` `ask({ retriever })`. */
export type Retriever = (params: {
  question: string;
  k?: number;
  filter?: Filter;
}) => Promise<QueryResult[]>;
