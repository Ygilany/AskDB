/**
 * Canonical defaults applied in {@link flattenAskDbConfig} when optional env-backed
 * fields are unset (missing, blank, or invalid after trim).
 */
export const DEFAULT_OPENAI_LANGUAGE_MODEL = "gpt-4o-mini";
/** @deprecated Use DEFAULT_OPENAI_LANGUAGE_MODEL. Removed at 1.0. */
export const DEFAULT_OPENAI_CHAT_MODEL = DEFAULT_OPENAI_LANGUAGE_MODEL;
export const DEFAULT_AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_LANGUAGE_MODEL = "claude-sonnet-4-6";
/** @deprecated Use DEFAULT_ANTHROPIC_LANGUAGE_MODEL. Removed at 1.0. */
export const DEFAULT_ANTHROPIC_CHAT_MODEL = DEFAULT_ANTHROPIC_LANGUAGE_MODEL;
export const DEFAULT_GOOGLE_LANGUAGE_MODEL = "gemini-2.0-flash";
/** @deprecated Use DEFAULT_GOOGLE_LANGUAGE_MODEL. Removed at 1.0. */
export const DEFAULT_GOOGLE_CHAT_MODEL = DEFAULT_GOOGLE_LANGUAGE_MODEL;
export const DEFAULT_GATEWAY_LANGUAGE_MODEL = "openai/gpt-4o-mini";
/** @deprecated Use DEFAULT_GATEWAY_LANGUAGE_MODEL. Removed at 1.0. */
export const DEFAULT_GATEWAY_CHAT_MODEL = DEFAULT_GATEWAY_LANGUAGE_MODEL;
export const DEFAULT_INTROSPECT_OUTPUT_DIR = "./askdb/";
/** Default model-call timeout for `@askdb/http-api` `POST /ask` (`httpApi.requestTimeoutMs`). */
export const DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS = 60_000;
/**
 * Largest `httpApi.requestTimeoutMs`: the Node timer maximum (2^31 - 1 ms, about 24.8 days).
 * A larger `AbortSignal.timeout()` fires after 1 ms, or throws `ERR_OUT_OF_RANGE` past 2^32 - 1.
 */
export const MAX_HTTP_API_REQUEST_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_LOCAL_POSTGRES_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres";
/**
 * @deprecated AskDB has no default embedding model: set `ai.embedding.model`. This is only the
 * model a legacy `rag.embedder: "openai"` config translates to. Removed at 1.0.
 */
export const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small";
/** Under the same visible tree as {@link DEFAULT_INTROSPECT_OUTPUT_DIR} (`./askdb/…`). */
export const DEFAULT_RAG_FILE_BASE_PATH = "./askdb/rag";
export const DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS = 64;
export const DEFAULT_PGVECTOR_INDEX_STRATEGY = "hnsw" as const;
/** Default per-query statement timeout for Studio execute (`studio.execute.timeoutMs`). */
export const DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS = 30_000;
/** Default row cap for Studio execute results (`studio.execute.maxRows`). */
export const DEFAULT_STUDIO_EXECUTE_MAX_ROWS = 500;

export const PGVECTOR_INDEX_STRATEGIES = ["ivfflat", "hnsw", "none"] as const;
export type PgvectorIndexStrategyId = (typeof PGVECTOR_INDEX_STRATEGIES)[number];

/**
 * The width earlier versions assumed for an embedding model: 3072 for `text-embedding-3-large`,
 * else 1536, whatever the provider.
 *
 * @deprecated AskDB no longer assumes a width: it learns it from the embedding model
 * (`detectEmbeddingDimensions` in `@askdb/rag`). Removed at 1.0.
 */
export function defaultRagEmbeddingDimensions(model: string): number {
  return model.trim() === "text-embedding-3-large" ? 3072 : 1536;
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

/**
 * Parse `httpApi.requestTimeoutMs` (or its flat key `ASKDB_HTTP_REQUEST_TIMEOUT_MS`).
 * Returns `undefined` when unset; throws naming `source` unless the value is a positive
 * integer no larger than {@link MAX_HTTP_API_REQUEST_TIMEOUT_MS}.
 */
export function parseHttpApiRequestTimeoutMs(value: string | number | undefined, source: string): number | undefined {
  if (value === undefined) return undefined;
  // A JavaScript config can pass any type; only numbers and numeric strings are parsed.
  const n = typeof value === "number" || typeof value === "string" ? parsePositiveInteger(value) : undefined;
  if (n === undefined || n > MAX_HTTP_API_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `askdb.config: invalid ${source} ${JSON.stringify(value)} (expected a positive integer number of milliseconds, at most ${MAX_HTTP_API_REQUEST_TIMEOUT_MS}).`,
    );
  }
  return n;
}

export function normalizePgvectorIndexStrategy(raw: string | undefined): PgvectorIndexStrategyId {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PGVECTOR_INDEX_STRATEGY;
  const v = raw.trim().toLowerCase();
  if (v === "ivfflat" || v === "hnsw" || v === "none") return v;
  throw new Error(`Invalid pgvector indexStrategy "${raw}" (expected ivfflat | hnsw | none).`);
}
