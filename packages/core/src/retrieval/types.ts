/**
 * Minimal chunk-shaped payload that `@askdb/core` understands. The full
 * `ChunkPayload` from `@askdb/rag` is assignable to this — splitting the
 * shape this way avoids `@askdb/core` taking a hard dependency on
 * `@askdb/rag` while keeping the retrieval seam in `ask()`.
 */
export type RetrievedChunkType =
  | "table"
  | "column"
  | "cql"
  | "question"
  | "concept"
  | "relationship"
  | "tenant-policy";

export type RetrievedChunk = {
  id: string;
  type: RetrievedChunkType;
  text: string;
  schemaId: string;
  refs: string[];
  sensitive: boolean;
};

export type RetrievedResult = {
  id: string;
  score: number;
  payload: RetrievedChunk;
};

/** Shape consumed by `ask({ retriever })`. */
export type Retriever = (params: {
  question: string;
  k?: number;
  filter?: {
    schemaId?: string;
    types?: RetrievedChunkType[];
    refs?: string[];
  };
}) => Promise<RetrievedResult[]>;
