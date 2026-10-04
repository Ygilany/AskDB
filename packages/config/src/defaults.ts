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

/** Default output widths of the OpenAI embedding models AskDB knows. */
const OPENAI_EMBEDDING_DIMENSIONS: ReadonlyMap<string, number> = new Map([
  ["text-embedding-3-small", 1536],
  ["text-embedding-3-large", 3072],
  ["text-embedding-ada-002", 1536],
]);

/**
 * The default vector width of `model` on `provider`, when AskDB knows it for a fact: the OpenAI
 * embedding models on openai, and their `openai/…` ids on the Vercel AI Gateway. Returns
 * `undefined` for anything else, Azure and Foundry included, whose deployment names say nothing
 * certain about the model behind them; set `ai.embedding.dimensions` then.
 */
export function knownEmbeddingDimensions(provider: string, model: string): number | undefined {
  const p = provider.trim().toLowerCase();
  const m = model.trim();
  if (p === "openai") {
    return OPENAI_EMBEDDING_DIMENSIONS.get(m);
  }
  if (p === "gateway" && m.startsWith("openai/")) {
    return OPENAI_EMBEDDING_DIMENSIONS.get(m.slice("openai/".length));
  }
  return undefined;
}

/**
 * @deprecated Use {@link knownEmbeddingDimensions}, which returns `undefined` for a model it
 * doesn't know instead of guessing 1536. Removed at 1.0.
 */
export function defaultRagEmbeddingDimensions(model: string): number {
  return knownEmbeddingDimensions("openai", model) ?? 1536;
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
