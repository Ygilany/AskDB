/**
 * Defaults the config resolver (`resolve.ts`) fills in when an optional field is unset.
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
/** The default `httpApi.listen.port`. */
export const DEFAULT_HTTP_API_PORT = 3000;
/** The default `httpApi.listen.host`. */
export const DEFAULT_HTTP_API_HOST = "127.0.0.1";
/** Default model-call timeout for `@askdb/http-api` `POST /ask` (`httpApi.requestTimeoutMs`). */
export const DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS = 60_000;
/**
 * Largest `httpApi.requestTimeoutMs`: the Node timer maximum (2^31 - 1 ms, about 24.8 days).
 * A larger `AbortSignal.timeout()` fires after 1 ms, or throws `ERR_OUT_OF_RANGE` past 2^32 - 1.
 */
export const MAX_HTTP_API_REQUEST_TIMEOUT_MS = 2_147_483_647;
/**
 * @deprecated AskDB has no default embedding model: set `ai.embedding.model`. This is only the
 * model a legacy `rag.embedder` (`"openai"`, or `"ai-sdk"` on openai, azure or foundry) translates
 * to when no model is set. Removed at 1.0.
 */
export const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS = 64;
export const DEFAULT_PGVECTOR_INDEX_STRATEGY = "hnsw" as const;
/** Default per-query statement timeout for Studio execute (`studio.execute.timeoutMs`). */
export const DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS = 30_000;
/** Default row cap for Studio execute results (`studio.execute.maxRows`). */
export const DEFAULT_STUDIO_EXECUTE_MAX_ROWS = 500;

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
