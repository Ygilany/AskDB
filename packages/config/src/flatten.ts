import {
  ASKDB_LOG_LEVELS,
  ASKDB_MODES_V1,
  ASKDB_RAG_STORES,
} from "./constants.js";
import {
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS,
  DEFAULT_RAG_FILE_BASE_PATH,
  normalizePgvectorIndexStrategy,
  parsePositiveInteger,
} from "./defaults.js";
import {
  isMember,
  normalizeAskDbConfig,
  type NormalizedAiConnection,
  type NormalizedAiEmbeddingSection,
  type NormalizedAiLanguageSection,
  type NormalizedAskDbConfig,
} from "./normalize.js";
import type { AskDbAiReasoningConfig, AskDbConfig } from "./types.js";

function set(out: Record<string, string>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  const t = value.trim();
  if (t === "") return;
  out[key] = t;
}

/** Writes a connection's settings under the env keys `provider`'s `@askdb/ai` adapter reads. */
function applyAiConnection(out: Record<string, string>, provider: string, connection: NormalizedAiConnection): void {
  switch (provider) {
    case "openai":
      set(out, "OPENAI_API_KEY", connection.apiKey);
      set(out, "OPENAI_BASE_URL", connection.baseUrl);
      return;
    case "anthropic":
      set(out, "ANTHROPIC_API_KEY", connection.apiKey);
      set(out, "ANTHROPIC_BASE_URL", connection.baseUrl);
      return;
    case "google":
      set(out, "GOOGLE_GENERATIVE_AI_API_KEY", connection.apiKey);
      set(out, "GOOGLE_AI_BASE_URL", connection.baseUrl);
      return;
    case "gateway":
      set(out, "AI_GATEWAY_API_KEY", connection.apiKey);
      set(out, "ASKDB_AI_BASE_URL", connection.baseUrl);
      return;
    case "azure":
    case "foundry":
      // `@askdb/core` treats `foundry` like Azure for env parsing.
      set(out, "AZURE_OPENAI_API_KEY", connection.apiKey);
      set(out, "AZURE_OPENAI_API_KEY_SECONDARY", connection.secondaryApiKey);
      set(out, "ASKDB_AI_AZURE_RESOURCE_NAME", connection.resourceName);
      set(out, "AZURE_OPENAI_BASE_URL", connection.baseUrl);
      set(out, "AZURE_OPENAI_API_VERSION", connection.apiVersion);
      return;
    default:
      // Custom/third-party provider: the universal ASKDB_AI_* keys that @askdb/ai's
      // resolveBaseConfig honors for every registered adapter. Works end to end only when the
      // host registry contains an adapter with this provider name.
      set(out, "ASKDB_AI_API_KEY", connection.apiKey);
      set(out, "ASKDB_AI_BASE_URL", connection.baseUrl);
  }
}

function applyLanguageModel(out: Record<string, string>, section: NormalizedAiLanguageSection): void {
  const { provider, model } = section;
  if (provider === "openai") {
    set(out, "OPENAI_MODEL", model);
    set(out, "ASKDB_MODEL", model);
  } else if (provider === "azure" || provider === "foundry") {
    set(out, "AZURE_OPENAI_DEPLOYMENT", model);
    set(out, "AZURE_DEPLOYMENT_NAME", model);
    set(out, "ASKDB_AI_MODEL", model);
    set(out, "ASKDB_AI_AZURE_MODEL_FAMILY", section.modelFamily);
  } else {
    set(out, "ASKDB_AI_MODEL", model);
  }
}

function applyReasoningAi(out: Record<string, string>, reasoning: AskDbAiReasoningConfig | undefined): void {
  if (!reasoning) return;
  set(out, "ASKDB_AI_REASONING_EFFORT", reasoning.effort);
  set(out, "ASKDB_AI_REASONING_EFFORT_NL_TO_SQL", reasoning.nlToSql);
  set(out, "ASKDB_AI_REASONING_EFFORT_ENRICHMENT", reasoning.enrichment);
}

/** The env view of `ai.language`: its provider, its connection only, its model and reasoning. */
export function aiLanguageEnv(section: NormalizedAiLanguageSection): Record<string, string> {
  const out: Record<string, string> = {};
  set(out, "ASKDB_AI_PROVIDER", section.provider);
  applyAiConnection(out, section.provider, section.connection);
  applyLanguageModel(out, section);
  applyReasoningAi(out, section.reasoning);
  return out;
}

/** The env view of `ai.embedding`: its provider, its connection only, and its model. Nothing from the language side. */
export function aiEmbeddingEnv(section: NormalizedAiEmbeddingSection): Record<string, string> {
  const out: Record<string, string> = {};
  set(out, "ASKDB_AI_PROVIDER", section.provider);
  applyAiConnection(out, section.provider, section.connection);
  set(out, "ASKDB_AI_EMBEDDING_MODEL", section.model);
  return out;
}

/**
 * Flattens a nested {@link AskDbConfig} into canonical env keys for the runtime snapshot
 * (`AskDbEnvProjection.entries`). Deprecated keys are translated first (see
 * `normalizeAskDbConfig`); the AI keys come from the `ai.language` section's connection.
 */
export function flattenAskDbConfig(config: AskDbConfig): Record<string, string> {
  return flattenNormalizedAskDbConfig(normalizeAskDbConfig(config).config);
}

export function flattenNormalizedAskDbConfig(config: NormalizedAskDbConfig): Record<string, string> {
  const out: Record<string, string> = {};

  // --- AI ---
  Object.assign(out, aiLanguageEnv(config.ai.language));

  // --- Introspection ---
  const intro = config.introspection;
  if (intro.provider === "postgres") {
    set(out, "ASKDB_INTROSPECT_POSTGRES_URL", intro.providerConfig?.postgres?.databaseUrl);
  } else if (intro.provider === "prisma") {
    // schemaPath lives in structured config (introspection.providerConfig.prisma.schemaPath);
    // @askdb/prisma discovers it at runtime — no flat env key needed.
  } else if (intro.provider === "mysql") {
    set(out, "ASKDB_INTROSPECT_MYSQL_URL", intro.providerConfig?.mysql?.databaseUrl);
  } else if (intro.provider === "sqlite") {
    set(out, "ASKDB_INTROSPECT_SQLITE_FILE", intro.providerConfig?.sqlite?.file);
  } else if (intro.provider === "sqlserver") {
    set(out, "ASKDB_INTROSPECT_SQLSERVER_URL", intro.providerConfig?.sqlserver?.databaseUrl);
  }

  const outDir = intro.outputDir?.trim() || DEFAULT_INTROSPECT_OUTPUT_DIR;
  set(out, "ASKDB_INTROSPECT_OUT", outDir);
  set(out, "ASKDB_INTROSPECT_SCHEMAS", intro.schemas?.join(","));

  // --- RAG ---
  const rag = config.rag;
  set(out, "ASKDB_RAG_EMBEDDER", rag.embedder);
  const embedding = config.ai.embedding;
  const width = embedding?.dimensions;
  if (embedding) {
    set(out, "ASKDB_RAG_EMBEDDER_MODEL", embedding.model);
    if (width !== undefined) set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(width));
  }

  if (!isMember(rag.store, ASKDB_RAG_STORES)) {
    throw new Error(
      `askdb.config: invalid rag.store "${rag.store}" (expected one of: ${ASKDB_RAG_STORES.join(", ")}).`,
    );
  }
  if (rag.store === "file") {
    const f = rag.storeConfig.file;
    if (!f) throw new Error('askdb.config: rag.store is "file" but `rag.storeConfig.file` is missing.');
    const basePath = f.basePath?.trim() || DEFAULT_RAG_FILE_BASE_PATH;
    set(out, "ASKDB_RAG_FILE_BASE_PATH", basePath);
  } else if (rag.store === "memory") {
    // no env keys
  } else if (rag.store === "pgvector") {
    const p = rag.storeConfig.pgvector;
    if (!p) throw new Error('askdb.config: rag.store is "pgvector" but `rag.storeConfig.pgvector` is missing.');
    const url = p.databaseUrl?.trim();
    if (!url) {
      throw new Error(
        'askdb.config: rag.store is "pgvector" but `storeConfig.pgvector.databaseUrl` is missing (set ASKDB_PGVECTOR_URL via env in askdb.config).',
      );
    }
    set(out, "ASKDB_PGVECTOR_URL", url);
    // With `rag.embedder: "ai"`, normalization has already moved the width to ai.embedding and
    // refused a pgvector config whose width it can't know.
    const pgDims = embedding
      ? width
      : (parsePositiveInteger(p.dimensions) ?? DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS);
    if (pgDims !== undefined) set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(pgDims));
    const strategy = normalizePgvectorIndexStrategy(
      typeof p.indexStrategy === "string" ? p.indexStrategy : undefined,
    );
    set(out, "ASKDB_PGVECTOR_INDEX_STRATEGY", strategy);
  }

  // --- Logging ---
  if (config.logging?.level) {
    const lvl = config.logging.level;
    if (!isMember(lvl, ASKDB_LOG_LEVELS)) {
      throw new Error(
        `askdb.config: invalid logging.level "${lvl}" (expected one of: ${ASKDB_LOG_LEVELS.join(", ")}).`,
      );
    }
    set(out, "ASKDB_LOG_LEVEL", lvl);
  }
  set(out, "ASKDB_CORRELATION_ID", config.logging?.correlationId);

  // --- Modes ---
  if (config.modes?.askdbMode) {
    const m = config.modes.askdbMode;
    if (!isMember(m, ASKDB_MODES_V1)) {
      throw new Error(
        `askdb.config: invalid modes.askdbMode "${m}" (expected one of: ${ASKDB_MODES_V1.join(", ")}).`,
      );
    }
    set(out, "ASKDB_MODE", m);
  }
  if (config.modes?.omitSensitiveFromPrompt === true) {
    set(out, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT", "true");
  }

  // --- Host ---
  set(out, "ASKDB_SCHEMA_PATH", config.host?.schemaPath);
  set(out, "ASKDB_SCHEMA_JSON", config.host?.schemaJson);

  if (config.logging?.logFile) {
    set(out, "ASKDB_LOG_FILE", config.logging.logFile);
  }
  if (config.logging?.logStdout === true) {
    set(out, "ASKDB_LOG_STDOUT", "true");
  }

  // --- Dev ---
  if (config.dev?.mockSql) {
    set(out, "ASKDB_MOCK_SQL", config.dev.mockSql);
  }

  // --- Studio ---
  if (config.studio?.listen?.host) {
    set(out, "ASKDB_STUDIO_HOST", config.studio.listen.host);
  }
  if (config.studio?.listen?.port !== undefined && !Number.isNaN(config.studio.listen.port)) {
    set(out, "ASKDB_STUDIO_PORT", String(config.studio.listen.port));
  }
  set(out, "ASKDB_STUDIO_EXECUTE_PROVIDER", config.studio?.execute?.provider);
  set(out, "ASKDB_STUDIO_DATABASE_URL", config.studio?.execute?.databaseUrl);
  set(out, "ASKDB_STUDIO_SQLITE_FILE", config.studio?.execute?.file);
  const studioExecute = config.studio?.execute;
  if (studioExecute?.enabled !== undefined) {
    if (typeof studioExecute.enabled !== "boolean") {
      throw new Error("askdb.config: studio.execute.enabled must be a boolean.");
    }
    set(out, "ASKDB_STUDIO_EXECUTE_ENABLED", String(studioExecute.enabled));
  }
  if (studioExecute?.useIntrospectionConnection !== undefined) {
    if (typeof studioExecute.useIntrospectionConnection !== "boolean") {
      throw new Error("askdb.config: studio.execute.useIntrospectionConnection must be a boolean.");
    }
    set(
      out,
      "ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION",
      String(studioExecute.useIntrospectionConnection),
    );
  }
  for (const [field, key] of [
    ["timeoutMs", "ASKDB_STUDIO_EXECUTE_TIMEOUT_MS"],
    ["maxRows", "ASKDB_STUDIO_EXECUTE_MAX_ROWS"],
  ] as const) {
    const raw = studioExecute?.[field];
    if (raw === undefined) continue;
    const n = parsePositiveInteger(raw);
    if (n === undefined) {
      throw new Error(
        `askdb.config: studio.execute.${field} must be a positive integer (got ${JSON.stringify(raw)}).`,
      );
    }
    set(out, key, String(n));
  }
  // --- HTTP API listen (canonical keys on runtime flat map) ---
  const httpListen = config.httpApi?.listen;
  if (httpListen?.port !== undefined && !Number.isNaN(httpListen.port)) {
    set(out, "PORT", String(httpListen.port));
  }
  if (httpListen?.host) {
    set(out, "HOST", httpListen.host);
  }

  return out;
}
