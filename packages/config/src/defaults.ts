/**
 * Canonical defaults applied in {@link flattenAskDbConfig} when optional env-backed
 * fields are unset (missing, blank, or invalid after trim).
 */
export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";
export const DEFAULT_AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";
export const DEFAULT_GOOGLE_CHAT_MODEL = "gemini-2.0-flash";
export const DEFAULT_INTROSPECT_OUTPUT_DIR = "./askdb/";
export const DEFAULT_LOCAL_POSTGRES_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres";
export const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small";
/** Under the same visible tree as {@link DEFAULT_INTROSPECT_OUTPUT_DIR} (`./askdb/…`). */
export const DEFAULT_RAG_FILE_BASE_PATH = "./askdb/rag";
export const DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS = 64;
export const DEFAULT_PGVECTOR_INDEX_STRATEGY = "hnsw" as const;

export const PGVECTOR_INDEX_STRATEGIES = ["ivfflat", "hnsw", "none"] as const;
export type PgvectorIndexStrategyId = (typeof PGVECTOR_INDEX_STRATEGIES)[number];

/** Same heuristics as Studio / `@askdb/rag` CLI for common OpenAI embedding models. */
export function defaultRagEmbeddingDimensions(model: string): number {
  const m = model.trim();
  if (m === "text-embedding-3-large") return 3072;
  if (m === "text-embedding-ada-002") return 1536;
  return 1536;
}

export function parsePositiveInteger(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  const t = value.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

export function normalizePgvectorIndexStrategy(raw: string | undefined): PgvectorIndexStrategyId {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PGVECTOR_INDEX_STRATEGY;
  const v = raw.trim().toLowerCase();
  if (v === "ivfflat" || v === "hnsw" || v === "none") return v;
  throw new Error(`Invalid pgvector indexStrategy "${raw}" (expected ivfflat | hnsw | none).`);
}
