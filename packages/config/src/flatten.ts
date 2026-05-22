import {
  ASKDB_LOG_LEVELS,
  ASKDB_MODES_V1,
  ASKDB_RAG_EMBEDDERS,
  ASKDB_RAG_STORES,
} from "./constants.js";
import {
  DEFAULT_AZURE_OPENAI_DEPLOYMENT,
  DEFAULT_GOOGLE_CHAT_MODEL,
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_RAG_EMBEDDING_MODEL,
  DEFAULT_RAG_FILE_BASE_PATH,
  defaultRagEmbeddingDimensions,
  normalizePgvectorIndexStrategy,
  parsePositiveInteger,
} from "./defaults.js";
import type { AskDbConfig, AzureConfig, FoundryConfig, GoogleConfig, OpenaiConfig } from "./types.js";

function isMember<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function set(out: Record<string, string>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  const t = value.trim();
  if (t === "") return;
  out[key] = t;
}

function applyOpenAiAi(out: Record<string, string>, cfg: OpenaiConfig): void {
  set(out, "OPENAI_API_KEY", cfg.apiKey);
  set(out, "OPENAI_BASE_URL", cfg.baseUrl);
  const model = cfg.model?.trim() || DEFAULT_OPENAI_CHAT_MODEL;
  set(out, "OPENAI_MODEL", model);
  set(out, "ASKDB_MODEL", model);
}

function applyGoogleAi(out: Record<string, string>, cfg: GoogleConfig): void {
  set(out, "GOOGLE_GENERATIVE_AI_API_KEY", cfg.apiKey);
  set(out, "GOOGLE_AI_BASE_URL", cfg.baseUrl);
  const model = cfg.model?.trim() || DEFAULT_GOOGLE_CHAT_MODEL;
  set(out, "ASKDB_AI_MODEL", model);
}

function applyAzureLikeAi(out: Record<string, string>, cfg: AzureConfig | FoundryConfig): void {
  set(out, "AZURE_OPENAI_API_KEY", cfg.apiKey);
  if (cfg.secondaryApiKey) {
    set(out, "AZURE_OPENAI_API_KEY_SECONDARY", cfg.secondaryApiKey);
  }
  const model = cfg.model?.trim() || DEFAULT_AZURE_OPENAI_DEPLOYMENT;
  set(out, "AZURE_OPENAI_DEPLOYMENT", model);
  set(out, "AZURE_DEPLOYMENT_NAME", model);
  set(out, "ASKDB_AI_MODEL", model);
  set(out, "AZURE_OPENAI_BASE_URL", cfg.baseUrl);
  set(out, "AZURE_OPENAI_API_VERSION", cfg.apiVersion);
}

function resolveRagEmbeddingDimensions(rag: AskDbConfig["rag"]): number {
  if (rag.embedder === "openai" || rag.embedder === "ai-sdk") {
    const ec = rag.embedderConfig.openai;
    if (!ec) {
      throw new Error(`askdb.config: rag.embedderConfig.openai is required for embedder "${rag.embedder}".`);
    }
    const model = ec.model?.trim() || DEFAULT_RAG_EMBEDDING_MODEL;
    const parsed = parsePositiveInteger(ec.dimension);
    return parsed ?? defaultRagEmbeddingDimensions(model);
  }
  return DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS;
}

/**
 * Flattens a nested {@link AskDbConfig} into canonical env keys for the runtime snapshot
 * (`AskDbEnvProjection.entries`).
 */
export function flattenAskDbConfig(config: AskDbConfig): Record<string, string> {
  const out: Record<string, string> = {};

  // --- AI ---
  if (config.ai.provider === "openai") {
    set(out, "ASKDB_AI_PROVIDER", "openai");
    applyOpenAiAi(out, config.ai.providerConfig.openai);
  } else if (config.ai.provider === "azure") {
    set(out, "ASKDB_AI_PROVIDER", "azure");
    applyAzureLikeAi(out, config.ai.providerConfig.azure);
  } else if (config.ai.provider === "foundry") {
    // `@askdb/core` treats `foundry` like Azure for env parsing.
    set(out, "ASKDB_AI_PROVIDER", "foundry");
    applyAzureLikeAi(out, config.ai.providerConfig.foundry);
  } else if (config.ai.provider === "google") {
    set(out, "ASKDB_AI_PROVIDER", "google");
    applyGoogleAi(out, config.ai.providerConfig.google);
  } else if (config.ai.provider === "anthropic") {
    throw new Error("askdb.config: Anthropic AI provider is not supported yet.");
  }

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

  // --- RAG ---
  const rag = config.rag;
  if (!isMember(rag.embedder, ASKDB_RAG_EMBEDDERS)) {
    throw new Error(
      `askdb.config: invalid rag.embedder "${rag.embedder}" (expected one of: ${ASKDB_RAG_EMBEDDERS.join(", ")}).`,
    );
  }
  set(out, "ASKDB_RAG_EMBEDDER", rag.embedder);

  const resolvedRagDimensions = resolveRagEmbeddingDimensions(rag);

  if (rag.embedder === "openai" || rag.embedder === "ai-sdk") {
    const ec = rag.embedderConfig.openai;
    if (!ec) {
      throw new Error(`askdb.config: rag.embedderConfig.openai is required for embedder "${rag.embedder}".`);
    }
    const model = ec.model?.trim() || DEFAULT_RAG_EMBEDDING_MODEL;
    set(out, "ASKDB_RAG_EMBEDDER_MODEL", model);
    set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(resolvedRagDimensions));
    set(out, "ASKDB_RAG_EMBEDDER_API_KEY", ec.apiKey);
    set(out, "ASKDB_RAG_EMBEDDER_BASE_URL", ec.baseUrl);
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
    const pgDims = parsePositiveInteger(p.dimensions) ?? resolvedRagDimensions;
    set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(pgDims));
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
  set(out, "ASKDB_STUDIO_DATABASE_URL", config.studio?.execute?.databaseUrl);
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
