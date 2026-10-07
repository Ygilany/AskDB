import type { AskDbDialectId, AskDbIntrospectionProvider, AskDbRagStore, AskDbStudioExecuteProvider } from "./constants.js";
import { ASKDB_STUDIO_EXECUTE_PROVIDERS } from "./constants.js";
import type { AskDbConfig } from "./types.js";
import {
  DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS,
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  DEFAULT_STUDIO_EXECUTE_MAX_ROWS,
  DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS,
  parseHttpApiRequestTimeoutMs,
  parsePositiveInteger,
} from "./defaults.js";
import { aiEmbeddingEnv, aiLanguageEnv } from "./flatten.js";
import { normalizeAskDbConfig, type NormalizedAiConnection } from "./normalize.js";
import { flatToAiEnv, getAskDbRuntimeStore } from "./runtime-store.js";

/** One resolved `ai` section: its provider, the connection it uses, its model, and an env view built from that connection only. */
export type AskDbRuntimeAiSection = {
  provider: string;
  /** Connection name within `ai.providerConfig.<provider>`. */
  connection: string;
  model: string | undefined;
  /** `AiEnv` for `@askdb/ai` registry calls, built from this section's connection only. */
  env: Record<string, string | undefined>;
};

/**
 * Typed AI runtime settings for `@askdb/core` (not `process.env`).
 */
export type AskDbRuntimeAiConfig = {
  /**
   * Flat env-shaped map built from the runtime snapshot: the language view plus every other
   * canonical key. Pass to `@askdb/ai` registry methods such as `resolveAiConfig` and
   * `createLanguageModelFromEnv`.
   */
  aiEnv: Record<string, string | undefined>;
  /** `ai.language`: the language model. `model` is undefined only for a custom provider with no model set. */
  language: AskDbRuntimeAiSection & { modelFamily: string | undefined };
  /**
   * `ai.embedding`: the embedding model. Undefined unless `rag.embedder` is `"ai"`. Pass `env`
   * to `resolveEmbeddingConfig` / `createEmbeddingModelFromEnv`, and `{ dimensions }` as the
   * latter's options: `env` holds the connection and model, not the width.
   */
  embedding:
    | (AskDbRuntimeAiSection & {
        model: string;
        /**
         * `ai.embedding.dimensions`: the vector size to request from the provider. Undefined
         * leaves the width to the model; `detectEmbeddingDimensions` in `@askdb/rag` learns it.
         */
        dimensions: number | undefined;
      })
    | undefined;
};

/**
 * OpenAI embedder settings for the `askdb-rag` CLI. Filled from `ai.embedding` when its provider
 * is `openai`; otherwise only from the OpenAI language connection.
 */
export type AskDbRuntimeRagEmbedderConfig = {
  apiKey: string | undefined;
  baseURL: string | undefined;
  model: string | undefined;
};

export type AskDbRuntimeRagConfig = {
  embedder: AskDbRuntimeRagEmbedderConfig;
  /** `rag.store`, or `"memory"` when the config has no `rag` block. Read this rather than `structured.rag`, which is `undefined` when the block is omitted. */
  store: AskDbRagStore;
  /** `rag.storeConfig` as written, with no defaults filled in; `{}` when the config has no `rag` block or the block has no `storeConfig`. */
  storeConfig: NonNullable<AskDbConfig["rag"]>["storeConfig"];
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
  /** Whether `POST /ask` accepts a per-request `schemaJson` override. Default `false`. */
  allowSchemaOverride: boolean;
  /** Model-call timeout per `POST /ask` request, in milliseconds (1 to 2147483647). Default `60000`. */
  requestTimeoutMs: number;
};

export type AskDbRuntimeIntrospectionConfig = {
  provider: AskDbIntrospectionProvider;
  /**
   * Resolved Postgres connection URL when `provider === "postgres"`:
   * `providerConfig.postgres.databaseUrl` → `ASKDB_INTROSPECT_POSTGRES_URL` env.
   * `undefined` for non-Postgres providers.
   */
  postgresDatabaseUrl: string | undefined;
  /** Resolved from `introspection.providerConfig.prisma.schemaPath`; `undefined` triggers auto-discovery in `@askdb/prisma`. */
  prismaSchemaPath: string | undefined;
  /**
   * Resolved MySQL connection URL when `provider === "mysql"`:
   * `providerConfig.mysql.databaseUrl` → `ASKDB_INTROSPECT_MYSQL_URL` env.
   * `undefined` for non-MySQL providers.
   */
  mysqlDatabaseUrl: string | undefined;
  /**
   * Schemas (MySQL/MariaDB: databases) to introspect, for every provider:
   * `introspection.schemas` → `ASKDB_INTROSPECT_SCHEMAS` (comma-separated).
   * `undefined` means the engine's default. `askdb introspect --schemas` overrides it.
   */
  schemas: string[] | undefined;
  /**
   * Resolved SQLite file path when `provider === "sqlite"`:
   * `providerConfig.sqlite.file` → `ASKDB_INTROSPECT_SQLITE_FILE` env.
   * `undefined` for non-SQLite providers.
   */
  sqliteFile: string | undefined;
  /**
   * Resolved SQL Server connection URL when `provider === "sqlserver"`:
   * `providerConfig.sqlserver.databaseUrl` → `ASKDB_INTROSPECT_SQLSERVER_URL` env.
   * `undefined` for non-SQL Server providers.
   */
  sqlserverDatabaseUrl: string | undefined;
  /** Resolved from `introspection.outputDir`; falls back to the package default (`./askdb/`). */
  outputDir: string;
};

export type AskDbRuntimeDevConfig = {
  mockSql: string | undefined;
};

export type AskDbRuntimeModesConfig = {
  askdbMode: string | undefined;
  omitSensitiveFromPrompt: boolean;
};

export type AskDbRuntimeNlToSqlConfig = {
  /**
   * Optional NL→SQL dialect override from `askdb.config.ts`. When set, hosts
   * (CLI / HTTP API / Studio) pass this to `ask({ dialect })` instead of
   * inferring from the introspection provider.
   */
  dialect: AskDbDialectId | undefined;
};

export type AskDbRuntimeStudioConfig = {
  execute: {
    /**
     * Resolved execute provider. Falls back to the active introspection provider when it
     * is a live engine (`postgres`, `mysql`, `sqlite`, `sqlserver`), then defaults to
     * `"postgres"` for backward compatibility.
     */
    provider: AskDbStudioExecuteProvider;
    /** Connection URL used by the Studio playground query runner for network databases. */
    databaseUrl: string | undefined;
    /** SQLite file path used when `provider === "sqlite"`. */
    file: string | undefined;
    /** Whether `POST /api/execute` is allowed. Default `false` (opt-in). */
    enabled: boolean;
    /**
     * Whether `databaseUrl` / `file` may fall back to the active introspection
     * connection. Default `false`.
     */
    useIntrospectionConnection: boolean;
    /**
     * True when the introspection config has a connection for this provider that
     * Studio did not use because `useIntrospectionConnection` is off. Lets hosts
     * explain why execute reports "not configured".
     */
    introspectionConnectionAvailable: boolean;
    /** Per-query timeout in milliseconds. Default `30000`. */
    timeoutMs: number;
    /** Maximum rows returned per query. Default `500`. */
    maxRows: number;
  };
};

/**
 * Typed runtime view over the bootstrapped AskDB config snapshot.
 */
export type AskDbRuntimeConfig = {
  readonly structured: Readonly<AskDbConfig>;
  /** Canonical flattened map (subprocess env via {@link mergeAskDbFlatIntoEnvMap}). */
  readonly flat: Readonly<Record<string, string>>;
  ai: AskDbRuntimeAiConfig;
  introspection: AskDbRuntimeIntrospectionConfig;
  rag: AskDbRuntimeRagConfig;
  logging: AskDbRuntimeLoggingConfig;
  httpApi: AskDbRuntimeHttpApiConfig;
  dev: AskDbRuntimeDevConfig;
  modes: AskDbRuntimeModesConfig;
  nlToSql: AskDbRuntimeNlToSqlConfig;
  studio: AskDbRuntimeStudioConfig;
  /** One message per deprecated config key in use (it names the old and new key, never a value). */
  deprecations: readonly string[];
};

function isTruthyFlag(raw: string | undefined): boolean {
  return raw !== undefined && ["1", "true", "yes"].includes(raw.toLowerCase());
}

/** Normalization is pure, so it runs once per installed config object. */
const normalizedByConfig = new WeakMap<object, ReturnType<typeof normalizeAskDbConfig>>();

function normalizedFor(structured: Readonly<AskDbConfig>): ReturnType<typeof normalizeAskDbConfig> {
  let normalized = normalizedByConfig.get(structured);
  if (!normalized) {
    normalized = normalizeAskDbConfig(structured as AskDbConfig);
    normalizedByConfig.set(structured, normalized);
  }
  return normalized;
}

/** The runtime view of a resolved `ai` section, with `env` built from its connection only. */
function runtimeSection<M extends string | undefined>(
  section: { provider: string; connection: NormalizedAiConnection; model: M },
  env: Record<string, string>,
): AskDbRuntimeAiSection & { model: M } {
  return { provider: section.provider, connection: section.connection.name, model: section.model, env };
}

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
  const { config: normalized, deprecations } = normalizedFor(structured);
  const language = normalized.ai.language;
  const embeddingSection = normalized.ai.embedding;
  const embedding = embeddingSection
    ? {
        ...runtimeSection(embeddingSection, aiEmbeddingEnv(embeddingSection)),
        dimensions: embeddingSection.dimensions,
      }
    : undefined;
  // The RAG CLI's OpenAI embedder never reads another provider's key or base URL.
  const openaiEmbedding = embedding?.provider === "openai" ? embedding : undefined;

  const logStdoutRaw = pickFlat(flat, "ASKDB_LOG_STDOUT");
  const logStdout = isTruthyFlag(logStdoutRaw);

  const portRaw = pickFlat(flat, "PORT");
  const portParsed = portRaw !== undefined ? Number(portRaw) : NaN;
  const port =
    structured.httpApi?.listen?.port ??
    (!Number.isNaN(portParsed) ? portParsed : 3000);
  const host = structured.httpApi?.listen?.host ?? pickFlat(flat, "HOST") ?? "127.0.0.1";

  const omitRaw = pickFlat(flat, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT");
  const omitFromFlat = isTruthyFlag(omitRaw);

  const prismaSchemaPathRaw =
    structured.introspection.provider === "prisma"
      ? structured.introspection.providerConfig?.prisma?.schemaPath?.trim()
      : undefined;

  // Per-engine connection lookup. We deliberately only resolve the field for
  // the active provider so the runtime view stays minimal and other branches
  // surface `undefined` (cheap exhaustiveness check at the consumer).
  const postgresDatabaseUrl =
    structured.introspection.provider === "postgres"
      ? structured.introspection.providerConfig?.postgres?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_POSTGRES_URL")
      : undefined;
  const mysqlDatabaseUrl =
    structured.introspection.provider === "mysql"
      ? structured.introspection.providerConfig?.mysql?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_MYSQL_URL")
      : undefined;
  const schemas = (structured.introspection.schemas ?? pickFlat(flat, "ASKDB_INTROSPECT_SCHEMAS")?.split(","))
    ?.map((s) => s.trim())
    .filter(Boolean);
  const sqliteFile =
    structured.introspection.provider === "sqlite"
      ? structured.introspection.providerConfig?.sqlite?.file?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_SQLITE_FILE")
      : undefined;
  const sqlserverDatabaseUrl =
    structured.introspection.provider === "sqlserver"
      ? structured.introspection.providerConfig?.sqlserver?.databaseUrl?.trim() ||
        pickFlat(flat, "ASKDB_INTROSPECT_SQLSERVER_URL")
      : undefined;

  return {
    structured,
    flat,
    ai: {
      aiEnv,
      language: { ...runtimeSection(language, aiLanguageEnv(language)), modelFamily: language.modelFamily },
      embedding,
    },
    introspection: {
      provider: structured.introspection.provider,
      postgresDatabaseUrl,
      prismaSchemaPath: prismaSchemaPathRaw || undefined,
      mysqlDatabaseUrl,
      schemas: schemas?.length ? schemas : undefined,
      sqliteFile,
      sqlserverDatabaseUrl,
      outputDir:
        pickFlat(flat, "ASKDB_INTROSPECT_OUT") ??
        structured.introspection.outputDir?.trim() ??
        DEFAULT_INTROSPECT_OUTPUT_DIR,
    },
    rag: {
      embedder: openaiEmbedding
        ? {
            apiKey: openaiEmbedding.env.OPENAI_API_KEY,
            baseURL: openaiEmbedding.env.OPENAI_BASE_URL,
            model: openaiEmbedding.model,
          }
        : {
            apiKey: pickFlat(flat, "OPENAI_API_KEY"),
            baseURL: pickFlat(flat, "OPENAI_BASE_URL"),
            model: undefined,
          },
      store: normalized.rag.store,
      storeConfig: normalized.rag.storeConfig,
    },
    logging: {
      level: structured.logging?.level ?? pickFlat(flat, "ASKDB_LOG_LEVEL"),
      correlationId: structured.logging?.correlationId ?? pickFlat(flat, "ASKDB_CORRELATION_ID"),
      logFile: structured.logging?.logFile ?? pickFlat(flat, "ASKDB_LOG_FILE"),
      logStdout,
    },
    httpApi: {
      listen: { port, host },
      // Only a real boolean counts: flattening rejects anything else, so a store installed
      // without it falls back to the flat key, which is set only for `true`.
      allowSchemaOverride:
        typeof structured.httpApi?.allowSchemaOverride === "boolean"
          ? structured.httpApi.allowSchemaOverride
          : isTruthyFlag(pickFlat(flat, "ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE")),
      requestTimeoutMs:
        parseHttpApiRequestTimeoutMs(structured.httpApi?.requestTimeoutMs, "httpApi.requestTimeoutMs") ??
        parseHttpApiRequestTimeoutMs(pickFlat(flat, "ASKDB_HTTP_REQUEST_TIMEOUT_MS"), "ASKDB_HTTP_REQUEST_TIMEOUT_MS") ??
        DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS,
    },
    dev: {
      mockSql: structured.dev?.mockSql ?? pickFlat(flat, "ASKDB_MOCK_SQL"),
    },
    modes: {
      askdbMode: structured.modes?.askdbMode ?? pickFlat(flat, "ASKDB_MODE"),
      omitSensitiveFromPrompt: Boolean(structured.modes?.omitSensitiveFromPrompt) || omitFromFlat,
    },
    nlToSql: {
      dialect: structured.dialect,
    },
    studio: {
      execute: resolveStudioExecuteConfig(structured, flat),
    },
    deprecations,
  };
}

function resolveStudioExecuteConfig(
  structured: Readonly<AskDbConfig>,
  flat: Readonly<Record<string, string>>,
): AskDbRuntimeStudioConfig["execute"] {
  // 1. Explicit provider from structured config or env.
  const providerRaw =
    structured.studio?.execute?.provider ??
    pickFlat(flat, "ASKDB_STUDIO_EXECUTE_PROVIDER");

  let provider: AskDbStudioExecuteProvider;
  if (providerRaw !== undefined && (ASKDB_STUDIO_EXECUTE_PROVIDERS as ReadonlyArray<string>).includes(providerRaw)) {
    provider = providerRaw as AskDbStudioExecuteProvider;
  } else {
    // 2. Fall back to introspection provider when it is a live execute provider.
    const introspectionProvider = structured.introspection?.provider;
    if (introspectionProvider !== undefined && (ASKDB_STUDIO_EXECUTE_PROVIDERS as ReadonlyArray<string>).includes(introspectionProvider)) {
      provider = introspectionProvider as AskDbStudioExecuteProvider;
    } else {
      // 3. Default to postgres for backward compatibility.
      provider = "postgres";
    }
  }

  const execute = structured.studio?.execute;
  const enabled =
    (typeof execute?.enabled === "boolean" ? execute.enabled : undefined) ??
    parseFlatBoolean(pickFlat(flat, "ASKDB_STUDIO_EXECUTE_ENABLED")) ??
    false;
  const useIntrospectionConnection =
    (typeof execute?.useIntrospectionConnection === "boolean" ? execute.useIntrospectionConnection : undefined) ??
    parseFlatBoolean(pickFlat(flat, "ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION")) ??
    false;
  const timeoutMs =
    parsePositiveInteger(execute?.timeoutMs) ??
    parsePositiveInteger(pickFlat(flat, "ASKDB_STUDIO_EXECUTE_TIMEOUT_MS")) ??
    DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS;
  const maxRows =
    parsePositiveInteger(execute?.maxRows) ??
    parsePositiveInteger(pickFlat(flat, "ASKDB_STUDIO_EXECUTE_MAX_ROWS")) ??
    DEFAULT_STUDIO_EXECUTE_MAX_ROWS;

  // Connection resolution — each provider draws from its own structured field
  // first, then the relevant flat env key. The introspection connection is only
  // reused when `useIntrospectionConnection` is explicitly on, so turning execute
  // on never silently runs ad-hoc SQL with introspection credentials.
  const introspectionConnection = introspectionConnectionFor(provider, structured, flat);
  let databaseUrl: string | undefined;
  let file: string | undefined;

  if (provider === "sqlite") {
    file = execute?.file?.trim() || pickFlat(flat, "ASKDB_STUDIO_SQLITE_FILE");
  } else {
    databaseUrl = execute?.databaseUrl?.trim() || pickFlat(flat, "ASKDB_STUDIO_DATABASE_URL");
  }
  const explicit = provider === "sqlite" ? file : databaseUrl;
  if (!explicit && useIntrospectionConnection && introspectionConnection) {
    if (provider === "sqlite") file = introspectionConnection;
    else databaseUrl = introspectionConnection;
  }

  return {
    provider,
    databaseUrl,
    file,
    enabled,
    useIntrospectionConnection,
    introspectionConnectionAvailable:
      !explicit && !useIntrospectionConnection && introspectionConnection !== undefined,
    timeoutMs,
    maxRows,
  };
}

function introspectionConnectionFor(
  provider: AskDbStudioExecuteProvider,
  structured: Readonly<AskDbConfig>,
  flat: Readonly<Record<string, string>>,
): string | undefined {
  const intro = structured.introspection;
  if (intro?.provider !== provider) return undefined;
  switch (provider) {
    case "postgres":
      return intro.providerConfig?.postgres?.databaseUrl?.trim() || pickFlat(flat, "ASKDB_INTROSPECT_POSTGRES_URL");
    case "mysql":
      return intro.providerConfig?.mysql?.databaseUrl?.trim() || pickFlat(flat, "ASKDB_INTROSPECT_MYSQL_URL");
    case "sqlserver":
      return intro.providerConfig?.sqlserver?.databaseUrl?.trim() || pickFlat(flat, "ASKDB_INTROSPECT_SQLSERVER_URL");
    case "sqlite":
      return intro.providerConfig?.sqlite?.file?.trim() || pickFlat(flat, "ASKDB_INTROSPECT_SQLITE_FILE");
  }
}

function parseFlatBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}
