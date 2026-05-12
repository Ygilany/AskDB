import type { SchemaV2Warning, V2Concept, V2Table } from "@askdb/core";
import type { SuggestSource, TableDraft } from "@askdb/enrich";
import type { ChunkType } from "@askdb/rag";

export type StudioTableDto = {
  physical: V2Table;
  filename: string;
  hasDescribableFile: boolean;
  draft: TableDraft;
  missingColumnIds: string[];
};

export type StudioWorkspaceDto = {
  schemaDir: string;
  schemaId: string;
  warnings: SchemaV2Warning[];
  aiConfigured: boolean;
  model: string;
  aiProvider: string;
  tables: StudioTableDto[];
  concepts: V2Concept[];
};

export type StudioErrorDto = {
  error: {
    message: string;
  };
};

export type SaveTableRequest = {
  draft: TableDraft;
};

export type SuggestRequest = {
  source: SuggestSource;
};

export type SuggestResponse = {
  candidates: Array<{ text: string }>;
};

export type StudioRagStatusDto = {
  schemaId: string;
  embedder: {
    kind: "mock" | "ai-sdk";
    label: string;
    configured: boolean;
    expectedId: string;
    indexedId: string | null;
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
  };
  embedderId: string;
  expectedEmbedderId: string;
  hasIndex: boolean;
  stale: boolean;
  updatedAt: string | null;
  chunksTotal: number;
  chunksIndexed: number;
  dimensions: number;
  expectedDimensions: number;
  sensitiveExcluded: number;
  sensitiveIncluded: number;
  files: {
    lock: boolean;
    embeddingsJson: boolean;
    embeddingsBin: boolean;
  };
};

export type RagIndexResponse = {
  status: StudioRagStatusDto;
  stats: {
    chunksTotal?: number;
    chunksIndexed?: number;
    chunksReused?: number;
    sensitiveExcluded?: number;
    sensitiveIncluded?: number;
  };
};

export type RagQueryRequest = {
  question: string;
  k?: number;
  types?: ChunkType[];
};

export type StudioRagChunkDto = {
  id: string;
  score: number;
  type: ChunkType;
  refs: string[];
  sensitive: boolean;
  text: string;
};

export type RagQueryResponse = {
  question: string;
  k: number;
  results: StudioRagChunkDto[];
};

export type AskRequest = {
  question: string;
  mode?: "full" | "rag";
};

export type AskResponse = {
  sql: string;
  explain: unknown | null;
  warnings: SchemaV2Warning[];
  rag: {
    enabled: boolean;
    chunks: StudioRagChunkDto[];
  };
};
