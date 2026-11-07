/**
 * Defaults the config resolver (`resolve.ts`) fills in when an optional field is unset.
 */
export const DEFAULT_OPENAI_LANGUAGE_MODEL = "gpt-4o-mini";
export const DEFAULT_AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_LANGUAGE_MODEL = "claude-sonnet-4-6";
export const DEFAULT_GOOGLE_LANGUAGE_MODEL = "gemini-2.0-flash";
export const DEFAULT_GATEWAY_LANGUAGE_MODEL = "openai/gpt-4o-mini";
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
export const DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS = 64;
export const DEFAULT_PGVECTOR_INDEX_STRATEGY = "hnsw" as const;
/** Default per-query statement timeout for Studio execute (`studio.execute.timeoutMs`). */
export const DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS = 30_000;
/** Default row cap for Studio execute results (`studio.execute.maxRows`). */
export const DEFAULT_STUDIO_EXECUTE_MAX_ROWS = 500;
