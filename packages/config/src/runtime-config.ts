import { env } from "./env.js";

/**
 * Typed AI runtime settings.
 *
 * `env` is the full bootstrapped runtime environment, suitable for passing to
 * `@askdb/core` env-aware functions (`resolveAskDbAiConfig`, `createAskDbLanguageModelFromEnv`, …).
 * Named scalar fields give library code typed, name-safe access to common AI settings
 * without knowing the underlying env var names.
 */
export type AskDbRuntimeAiConfig = {
  /**
   * Full runtime env map (post-bootstrap).
   * Pass this to `@askdb/core` functions that accept an `AskDbAiEnv` parameter instead of
   * referencing `process.env` or calling `getAskDbRuntimeEnv()` directly.
   *
   * **Do not mutate** this object — it is the live `process.env` reference.
   */
  env: NodeJS.ProcessEnv;
  /** Value of `ASKDB_TUI_MODEL` — per-app model override for the TUI. */
  tuiModel: string | undefined;
  /** Value of `ASKDB_STUDIO_MODEL` — per-app model override for Studio. */
  studioModel: string | undefined;
};

/**
 * Typed RAG embedder settings resolved from the runtime environment.
 */
export type AskDbRuntimeRagEmbedderConfig = {
  /**
   * Embedder API key.
   * Resolved as: `ASKDB_RAG_EMBEDDER_API_KEY` → `ASKDB_AI_API_KEY` → `OPENAI_API_KEY`.
   */
  apiKey: string | undefined;
  /**
   * Embedder base URL.
   * Resolved as: `ASKDB_RAG_EMBEDDER_BASE_URL` → `ASKDB_AI_BASE_URL` → `OPENAI_BASE_URL`.
   */
  baseURL: string | undefined;
  /** Embedder model name: `ASKDB_RAG_EMBEDDER_MODEL`. */
  model: string | undefined;
};

/** Typed RAG runtime settings. */
export type AskDbRuntimeRagConfig = {
  embedder: AskDbRuntimeRagEmbedderConfig;
};

/** Typed logging runtime settings. */
export type AskDbRuntimeLoggingConfig = {
  /** `ASKDB_LOG_LEVEL`. */
  level: string | undefined;
  /** `ASKDB_CORRELATION_ID`. */
  correlationId: string | undefined;
};

/**
 * Typed runtime config derived from the bootstrapped `process.env`.
 *
 * Library packages use {@link getAskDbRuntimeConfig} instead of reading
 * `process.env` or calling `env()` directly. This keeps `process.env`
 * access centralised in `@askdb/config` and gives callers a typed,
 * name-safe API that does not require knowing raw env var names.
 */
export type AskDbRuntimeConfig = {
  /** AI settings. Pass `ai.env` to `@askdb/core` env-aware functions. */
  ai: AskDbRuntimeAiConfig;
  /** RAG-specific settings. */
  rag: AskDbRuntimeRagConfig;
  /** Logging defaults. */
  logging: AskDbRuntimeLoggingConfig;
};

/**
 * Returns a typed config object derived from the current (bootstrapped) runtime environment.
 *
 * **This is the canonical way for library packages to read configuration.**
 * Packages must not call `env()`, `requiredEnv()`, or `getAskDbRuntimeEnv()` directly —
 * they should call `getAskDbRuntimeConfig()` and use the returned typed fields.
 *
 * First-party apps call {@link bootstrapAskDbEnv} (which loads `.env` and merges
 * `askdb.config.*`) before any library code runs, so all env keys are populated
 * by the time this function is called.
 *
 * @example
 * ```ts
 * import { getAskDbRuntimeConfig } from "@askdb/config";
 *
 * const config = getAskDbRuntimeConfig();
 * const apiKey = opts.apiKey ?? config.rag.embedder.apiKey;
 * const level   = config.logging.level;
 * // For @askdb/core functions that need the full env map:
 * const model = await createAskDbLanguageModelFromEnv(config.ai.env, { ... });
 * ```
 */
export function getAskDbRuntimeConfig(): AskDbRuntimeConfig {
  return {
    ai: {
      env: process.env,
      tuiModel: env("ASKDB_TUI_MODEL"),
      studioModel: env("ASKDB_STUDIO_MODEL"),
    },
    rag: {
      embedder: {
        apiKey:
          env("ASKDB_RAG_EMBEDDER_API_KEY") ??
          env("ASKDB_AI_API_KEY") ??
          env("OPENAI_API_KEY"),
        baseURL:
          env("ASKDB_RAG_EMBEDDER_BASE_URL") ??
          env("ASKDB_AI_BASE_URL") ??
          env("OPENAI_BASE_URL"),
        model: env("ASKDB_RAG_EMBEDDER_MODEL"),
      },
    },
    logging: {
      level: env("ASKDB_LOG_LEVEL"),
      correlationId: env("ASKDB_CORRELATION_ID"),
    },
  };
}
