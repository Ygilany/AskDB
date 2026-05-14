import {
  ASKDB_LOG_LEVELS,
  ASKDB_MODES_V1,
  ASKDB_RAG_EMBEDDERS,
  ASKDB_RAG_STORES,
} from "./constants.js";
import {
  DEFAULT_AZURE_OPENAI_DEPLOYMENT,
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  DEFAULT_LOCAL_POSTGRES_URL,
  DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_RAG_EMBEDDING_MODEL,
  DEFAULT_RAG_FILE_BASE_PATH,
  defaultRagEmbeddingDimensions,
  normalizePgvectorIndexStrategy,
  parsePositiveInteger,
} from "./defaults.js";
import type { AskDbConfig } from "./types.js";

function isMember<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function set(out: Record<string, string>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  const t = value.trim();
  if (t === "") return;
  out[key] = t;
}

function applyOpenAiAi(out: Record<string, string>, cfg: NonNullable<AskDbConfig["ai"]["providerConfig"]["openai"]>): void {
  set(out, "OPENAI_API_KEY", cfg.apiKey);
  set(out, "OPENAI_BASE_URL", cfg.baseUrl);
  const model = cfg.model?.trim() || DEFAULT_OPENAI_CHAT_MODEL;
  set(out, "OPENAI_MODEL", model);
  set(out, "ASKDB_MODEL", model);
}

function applyAzureLikeAi(
  out: Record<string, string>,
  cfg: NonNullable<AskDbConfig["ai"]["providerConfig"]["azure"] | AskDbConfig["ai"]["providerConfig"]["foundry"]>,
): void {
  set(out, "AZURE_OPENAI_API_KEY", cfg.apiKey);
  if ("secondaryApiKey" in cfg && cfg.secondaryApiKey) {
    set(out, "AZURE_OPENAI_API_KEY_SECONDARY", cfg.secondaryApiKey);
  }
  const model = cfg.model?.trim() || DEFAULT_AZURE_OPENAI_DEPLOYMENT;
  set(out, "AZURE_OPENAI_DEPLOYMENT", model);
  set(out, "AZURE_DEPLOYMENT_NAME", model);
  set(out, "ASKDB_AI_MODEL", model);
  set(out, "AZURE_OPENAI_BASE_URL", cfg.baseUrl);
  set(out, "AZURE_OPENAI_API_VERSION", cfg.apiVersion);
}

function resolveDatabaseUrl(config: AskDbConfig): string {
  const raw = config.database.providerConfig.postgres.databaseUrl;
  const fromConfig = raw?.trim();
  const fromShell = process.env.DATABASE_URL?.trim();
  return fromConfig || fromShell || DEFAULT_LOCAL_POSTGRES_URL;
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
 * Flattens a nested {@link AskDbConfig} into canonical `process.env` keys consumed by AskDB apps.
 */
export function flattenAskDbConfig(config: AskDbConfig): Record<string, string> {
  const out: Record<string, string> = {};

  // --- AI ---
  const { provider, providerConfig } = config.ai;
  if (provider === "openai") {
    if (!providerConfig.openai) {
      throw new Error('askdb.config: ai.provider is "openai" but `ai.providerConfig.openai` is missing.');
    }
    set(out, "ASKDB_AI_PROVIDER", "openai");
    applyOpenAiAi(out, providerConfig.openai);
  } else if (provider === "azure") {
    if (!providerConfig.azure) {
      throw new Error('askdb.config: ai.provider is "azure" but `ai.providerConfig.azure` is missing.');
    }
    set(out, "ASKDB_AI_PROVIDER", "azure");
    applyAzureLikeAi(out, providerConfig.azure);
  } else if (provider === "foundry") {
    if (!providerConfig.foundry) {
      throw new Error('askdb.config: ai.provider is "foundry" but `ai.providerConfig.foundry` is missing.');
    }
    // `@askdb/core` treats `foundry` like Azure for env parsing.
    set(out, "ASKDB_AI_PROVIDER", "foundry");
    applyAzureLikeAi(out, providerConfig.foundry);
  }

  if (providerConfig.anthropic !== undefined && Object.keys(providerConfig.anthropic as object).length > 0) {
    throw new Error("askdb.config: Anthropic AI provider is not supported yet.");
  }
  if (providerConfig.google !== undefined && Object.keys(providerConfig.google as object).length > 0) {
    throw new Error("askdb.config: Google AI provider is not supported yet.");
  }

  // --- Database ---
  if (config.database.provider !== "postgres") {
    throw new Error(`askdb.config: unsupported database.provider "${config.database.provider}".`);
  }
  set(out, "DATABASE_URL", resolveDatabaseUrl(config));

  // --- Introspection ---
  const intro = config.introspection;
  // `DATABASE_URL` already reflects `database`. For Postgres introspection, set
  // `introspection.providerConfig.postgres.databaseUrl` only when you need a URL that
  // differs from the main app database; when omitted, live introspection reuses the same URL.
  if (intro.provider === "postgres") {
    const introUrl = intro.providerConfig.postgres?.databaseUrl?.trim();
    if (introUrl) {
      set(out, "DATABASE_URL", introUrl);
    }
  } else if (intro.provider === "prisma") {
    const schemaPath = intro.providerConfig.prisma?.schemaPath;
    if (schemaPath) set(out, "ASKDB_PRISMA_SCHEMA", schemaPath);
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

  return out;
}
