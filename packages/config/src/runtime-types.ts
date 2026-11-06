import type {
  AskDbDialectId,
  AskDbIntrospectionProvider,
  AskDbLogLevel,
  AskDbModeV1,
  AskDbRagStore,
  AskDbStudioExecuteProvider,
} from "./constants.js";
import type { AskDbConfig } from "./types.js";

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
  /** `logging.level`; `undefined` leaves the level to each tool (the CLI and the HTTP API server differ). */
  level: AskDbLogLevel | undefined;
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
   * `providerConfig.postgres.databaseUrl`. Never read from `process.env`.
   * `undefined` for non-Postgres providers.
   */
  postgresDatabaseUrl: string | undefined;
  /** Resolved from `introspection.providerConfig.prisma.schemaPath`; `undefined` triggers auto-discovery in `@askdb/prisma`. */
  prismaSchemaPath: string | undefined;
  /**
   * Resolved MySQL connection URL when `provider === "mysql"`:
   * `providerConfig.mysql.databaseUrl`. Never read from `process.env`.
   * `undefined` for non-MySQL providers.
   */
  mysqlDatabaseUrl: string | undefined;
  /**
   * Schemas (MySQL/MariaDB: databases) to introspect, for every provider: `introspection.schemas`.
   * `undefined` means the engine's default. `askdb introspect --schemas` overrides it.
   */
  schemas: string[] | undefined;
  /**
   * Resolved SQLite file path when `provider === "sqlite"`:
   * `providerConfig.sqlite.file`. Never read from `process.env`.
   * `undefined` for non-SQLite providers.
   */
  sqliteFile: string | undefined;
  /**
   * Resolved SQL Server connection URL when `provider === "sqlserver"`:
   * `providerConfig.sqlserver.databaseUrl`. Never read from `process.env`.
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
  /** `modes.askdbMode`; `undefined` means `"schema_only"`. */
  askdbMode: AskDbModeV1 | undefined;
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
 * Typed runtime view over the bootstrapped AskDB config snapshot. Every field is resolved from
 * `structured`; `flat` and `ai.aiEnv` are projections of the same resolution, never read back.
 */
export type AskDbRuntimeConfig = {
  readonly structured: Readonly<AskDbConfig>;
  /** Canonical flattened map (subprocess env via {@link mergeAskDbFlatIntoEnvMap}), built from `structured`. */
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
