import type { AskDbConfig } from "./types.js";
import { flatToAiEnv, getAskDbRuntimeStore } from "./runtime-store.js";

/**
 * Typed AI runtime settings for `@askdb/core` (not `process.env`).
 */
export type AskDbRuntimeAiConfig = {
  /**
   * Flat env-shaped map built from the runtime snapshot. Pass to
   * `resolveAskDbAiConfig`, `createAskDbLanguageModelFromEnv`, etc.
   */
  aiEnv: Record<string, string | undefined>;
  tuiModel: string | undefined;
  studioModel: string | undefined;
};

export type AskDbRuntimeRagEmbedderConfig = {
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string | undefined;
};

export type AskDbRuntimeRagConfig = {
  embedder: AskDbRuntimeRagEmbedderConfig;
};

export type AskDbRuntimeLoggingConfig = {
  level: string | undefined;
  correlationId: string | undefined;
  logFile: string | undefined;
  logStdout: boolean;
};

export type AskDbRuntimeHttpApiConfig = {
  listen: {
    port: number;
    host: string;
  };
};

export type AskDbRuntimeDevConfig = {
  mockSql: string | undefined;
};

export type AskDbRuntimeModesConfig = {
  askdbMode: string | undefined;
  omitSensitiveFromPrompt: boolean;
};

/**
 * Typed runtime view over the bootstrapped AskDB config snapshot.
 */
export type AskDbRuntimeConfig = {
  readonly structured: Readonly<AskDbConfig>;
  /** Canonical flattened map (subprocess env via {@link mergeAskDbFlatIntoEnvMap}). */
  readonly flat: Readonly<Record<string, string>>;
  ai: AskDbRuntimeAiConfig;
  rag: AskDbRuntimeRagConfig;
  logging: AskDbRuntimeLoggingConfig;
  httpApi: AskDbRuntimeHttpApiConfig;
  dev: AskDbRuntimeDevConfig;
  modes: AskDbRuntimeModesConfig;
};

function pickFlat(flat: Readonly<Record<string, string>>, key: string): string | undefined {
  const v = flat[key];
  if (v === undefined || v.trim() === "") return undefined;
  return v.trim();
}

/**
 * Returns typed runtime configuration from the snapshot installed by {@link bootstrapAskDbEnv}.
 */
export function getAskDbRuntimeConfig(): AskDbRuntimeConfig {
  const { structured, flat } = getAskDbRuntimeStore();
  const aiEnv = flatToAiEnv(flat);

  const logStdoutRaw = pickFlat(flat, "ASKDB_LOG_STDOUT");
  const logStdout = logStdoutRaw !== undefined && ["1", "true", "yes"].includes(logStdoutRaw.toLowerCase());

  const portRaw = pickFlat(flat, "PORT");
  const portParsed = portRaw !== undefined ? Number(portRaw) : NaN;
  const port =
    structured.httpApi?.listen?.port ??
    (!Number.isNaN(portParsed) ? portParsed : 3000);
  const host = structured.httpApi?.listen?.host ?? pickFlat(flat, "HOST") ?? "127.0.0.1";

  const omitRaw = pickFlat(flat, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT");
  const omitFromFlat =
    omitRaw !== undefined && ["1", "true", "yes"].includes(omitRaw.toLowerCase());

  return {
    structured,
    flat,
    ai: {
      aiEnv,
      tuiModel: structured.tui?.model ?? pickFlat(flat, "ASKDB_TUI_MODEL"),
      studioModel: structured.studio?.model ?? pickFlat(flat, "ASKDB_STUDIO_MODEL"),
    },
    rag: {
      embedder: {
        apiKey:
          pickFlat(flat, "ASKDB_RAG_EMBEDDER_API_KEY") ??
          pickFlat(flat, "ASKDB_AI_API_KEY") ??
          pickFlat(flat, "OPENAI_API_KEY"),
        baseURL:
          pickFlat(flat, "ASKDB_RAG_EMBEDDER_BASE_URL") ??
          pickFlat(flat, "ASKDB_AI_BASE_URL") ??
          pickFlat(flat, "OPENAI_BASE_URL"),
        model: pickFlat(flat, "ASKDB_RAG_EMBEDDER_MODEL"),
      },
    },
    logging: {
      level: structured.logging?.level ?? pickFlat(flat, "ASKDB_LOG_LEVEL"),
      correlationId: structured.logging?.correlationId ?? pickFlat(flat, "ASKDB_CORRELATION_ID"),
      logFile: structured.logging?.logFile ?? pickFlat(flat, "ASKDB_LOG_FILE"),
      logStdout,
    },
    httpApi: {
      listen: { port, host },
    },
    dev: {
      mockSql: structured.dev?.mockSql ?? pickFlat(flat, "ASKDB_MOCK_SQL"),
    },
    modes: {
      askdbMode: structured.modes?.askdbMode ?? pickFlat(flat, "ASKDB_MODE"),
      omitSensitiveFromPrompt: Boolean(structured.modes?.omitSensitiveFromPrompt) || omitFromFlat,
    },
  };
}
