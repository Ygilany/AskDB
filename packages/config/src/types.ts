import type {
  AskDbAiProviderId,
  AskDbDialectId,
  AskDbLogLevel,
  AskDbModeV1,
  AskDbRagEmbedder,
  AskDbRagStore,
  AskDbReasoningEffort,
  AskDbStudioExecuteProvider,
} from "./constants.js";

/**
 * Authoring-time AskDB configuration: nested groups (`ai`, `introspection`, `rag`, …)
 * passed to {@link defineConfig} in `askdb.config.*`, then flattened to canonical env keys for the runtime snapshot.
 *
 * Use with TypeScript's `satisfies` operator to validate the object literal without widening it, e.g.
 * `defineConfig({ ... } satisfies AskDbConfig)` or `const cfg = { ... } satisfies AskDbConfig`.
 *
 */

// ---------------------------------------------------------------------------
// AI provider connections
// ---------------------------------------------------------------------------

/** Legacy model fields every connection type still accepts until the 1.0 cutover. */
type LegacyConnectionModel = {
  /**
   * @deprecated Use `ai.language.model`. Translated at load (with a warning) when this is the
   * language section's connection, ignored on any other connection. Removed at 1.0.
   */
  model?: string;
};

/** Legacy Azure / Foundry field, also translated at load until the 1.0 cutover. */
type LegacyConnectionModelFamily = {
  /** @deprecated Use `ai.language.modelFamily`. Removed at 1.0. */
  modelFamily?: string;
};

/** OpenAI connection (`ai.providerConfig.openai`). */
export type OpenaiConnection = LegacyConnectionModel & {
  /** Flattened to `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Flattened to `OPENAI_BASE_URL`; use it for an OpenAI-compatible endpoint. */
  baseUrl?: string;
};

/** Azure OpenAI connection (`ai.providerConfig.azure`). */
export type AzureConnection = LegacyConnectionModel &
  LegacyConnectionModelFamily & {
    apiKey?: string;
    secondaryApiKey?: string;
    /**
     * Azure resource name — the subdomain of your endpoint, e.g. `"my-foundry"`
     * for `https://my-foundry.openai.azure.com`. One of `resourceName` or
     * `baseUrl` is required.
     */
    resourceName?: string;
    /** Full endpoint URL. Overrides `resourceName` when both are set. */
    baseUrl?: string;
    apiVersion?: string;
  };

/** Microsoft Foundry connection (`ai.providerConfig.foundry`): the same fields as {@link AzureConnection}. */
export type FoundryConnection = AzureConnection;

/** Anthropic connection (`ai.providerConfig.anthropic`). Anthropic has no embeddings API. */
export type AnthropicConnection = LegacyConnectionModel & {
  apiKey?: string;
  baseUrl?: string;
};

/** Google Gemini connection (`ai.providerConfig.google`). */
export type GoogleConnection = LegacyConnectionModel & {
  apiKey?: string;
  baseUrl?: string;
};

/** Vercel AI Gateway connection (`ai.providerConfig.gateway`), built into `ai` — no extra provider package. */
export type GatewayConnection = LegacyConnectionModel & {
  /** AI Gateway API key. Flattened to `AI_GATEWAY_API_KEY`. */
  apiKey?: string;
  baseUrl?: string;
};

/**
 * Connection for a provider AskDB has no dedicated type for, keyed by its provider id
 * (`ai.providerConfig.mistral`). Flattened to the universal `ASKDB_AI_*` keys; works end to
 * end only when the consuming registry has an adapter registered under that provider id.
 */
export type CustomConnection = LegacyConnectionModel & {
  apiKey?: string;
  baseUrl?: string;
};

/** A connection plus its name, unique within its provider. */
export type AiNamedConnection<T> = T & {
  /** Defaults to `"default"`. Unique within its provider. */
  name?: string;
};

/** One connection, or a list of them when a provider needs more than one (for example two Azure resources). */
export type AiConnections<T> = AiNamedConnection<T> | readonly AiNamedConnection<T>[];

/**
 * `ai.providerConfig`: provider connections only (keys, endpoints, resources, API versions),
 * keyed by provider id. The model choice lives in `ai.language` and `ai.embedding`.
 */
export type AiProviderConnections = {
  openai?: AiConnections<OpenaiConnection>;
  azure?: AiConnections<AzureConnection>;
  foundry?: AiConnections<FoundryConnection>;
  anthropic?: AiConnections<AnthropicConnection>;
  google?: AiConnections<GoogleConnection>;
  gateway?: AiConnections<GatewayConnection>;
  /**
   * Any other key is a custom provider id (an adapter registered under that name), whose
   * connection is a {@link CustomConnection}. TypeScript also checks the keys above against this
   * signature, so it accepts the widest built-in connection (Azure's) too.
   */
  [provider: string]: AiConnections<CustomConnection> | AiConnections<AzureConnection> | undefined;
};

/** @deprecated Use {@link OpenaiConnection}. Removed at 1.0. */
export type OpenaiConfig = OpenaiConnection;
/** @deprecated Use {@link AzureConnection}. Removed at 1.0. */
export type AzureConfig = AzureConnection;
/** @deprecated Use {@link FoundryConnection}. Removed at 1.0. */
export type FoundryConfig = FoundryConnection;
/** @deprecated Use {@link AnthropicConnection}. Removed at 1.0. */
export type AnthropicConfig = AnthropicConnection;
/** @deprecated Use {@link GoogleConnection}. Removed at 1.0. */
export type GoogleConfig = GoogleConnection;
/** @deprecated Use {@link GatewayConnection}. Removed at 1.0. */
export type GatewayConfig = GatewayConnection;

/**
 * Provider-portable reasoning/latency effort for AskDB model calls. Unset
 * (the default) preserves current behavior: no reasoning `providerOptions`
 * are sent, so the provider/model's own default applies.
 */
export type AskDbAiReasoningConfig = {
  /** Global default applied to every AskDB model-call site unless overridden below. */
  effort?: AskDbReasoningEffort;
  /**
   * Override for NL→SQL generation calls. This is the accuracy-sensitive
   * path — leave unset (provider default) or use `"medium"`/`"high"`.
   */
  nlToSql?: AskDbReasoningEffort;
  /**
   * Override for enrichment/suggestion calls. These are non-critical, so
   * it's safe to bias toward `"low"`/`"minimal"` for latency/cost.
   */
  enrichment?: AskDbReasoningEffort;
};

/** `ai.language`: the language model AskDB generates SQL and enrichment suggestions with. */
export type AskDbAiLanguageConfig = {
  /** Defaults to `ai.provider`. */
  provider?: AskDbAiProviderId | (string & {});
  /** Name of a connection in `ai.providerConfig.<provider>`. Defaults to `"default"`. */
  connection?: string;
  /** Defaults to the provider's default language model (none for a custom provider). On Azure, the deployment name. */
  model?: string;
  /**
   * Underlying model id when `model` is an alias, e.g. `"gpt-5"` or `"o3-mini"` behind an Azure
   * deployment name. Deployment names are arbitrary, so AskDB can't always infer reasoning-model
   * support from `model` alone. Read on Azure and Foundry.
   */
  modelFamily?: string;
  reasoning?: AskDbAiReasoningConfig;
};

/** `ai.embedding`: the embedding model behind `rag.embedder: "ai"`. Ignored when `rag.embedder` is `"mock"`. */
export type AskDbAiEmbeddingConfig = {
  /** Defaults to `ai.provider`. Anthropic has no embeddings API, so it can't be this section's provider. */
  provider?: AskDbAiProviderId | (string & {});
  /** Name of a connection in `ai.providerConfig.<provider>`. Defaults to `"default"`. */
  connection?: string;
  /** Required when `rag.embedder` is `"ai"`: AskDB has no default embedding model. On Azure, the deployment name. */
  model?: string;
  /**
   * Vector size to request from the provider, as a positive integer or a string holding one, for
   * models that let you choose one (OpenAI's text-embedding-3 models, Gemini's). Unset: the
   * model's own width, which AskDB learns from the model when it builds an index.
   */
  dimensions?: string | number;
};

/**
 * `ai`: provider connections plus one section per use of a model.
 *
 * - **`provider`**: the default provider for both sections.
 * - **`providerConfig`**: provider connections, keyed by provider id.
 * - **`language`**: the language model (NL→SQL, enrichment suggestions).
 * - **`embedding`**: the embedding model behind `rag.embedder: "ai"`.
 *
 * A section's provider is `section.provider ?? ai.provider`, and its connection is
 * `section.connection ?? "default"` within that provider. Loading fails when a section resolves
 * to no provider or to a connection that doesn't exist.
 */
export type AskDbAiConfig = {
  provider?: AskDbAiProviderId | (string & {});
  providerConfig?: AiProviderConnections;
  language?: AskDbAiLanguageConfig;
  embedding?: AskDbAiEmbeddingConfig;
  /** @deprecated Use `ai.language.reasoning`. Removed at 1.0. */
  reasoning?: AskDbAiReasoningConfig;
};

/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type OpenaiAiConfig = AskDbAiConfig;
/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type AzureAiConfig = AskDbAiConfig;
/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type FoundryAiConfig = AskDbAiConfig;
/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type AnthropicAiConfig = AskDbAiConfig;
/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type GoogleAiConfig = AskDbAiConfig;
/** @deprecated Use {@link AskDbAiConfig}. Removed at 1.0. */
export type GatewayAiConfig = AskDbAiConfig;

// ---------------------------------------------------------------------------
// RAG configs
// ---------------------------------------------------------------------------

/** @deprecated Use `ai.embedding` and a connection in `ai.providerConfig`. Translated at load (with a warning); removed at 1.0. */
export type OpenaiRagEmbedderConfig = {
  /** @deprecated Use `ai.embedding.model`. */
  model?: string;
  /** @deprecated Use `ai.embedding.dimensions`. */
  dimension?: string | number;
  /** @deprecated Put the key on a connection in `ai.providerConfig`. */
  apiKey?: string;
  /** @deprecated Put the base URL on a connection in `ai.providerConfig`. */
  baseUrl?: string;
};

export type FileStoreConfig = {
  /** Passed to `createFileStore({ basePath })` — vector files use `<basePath>.embeddings.*`. */
  basePath?: string;
  autoFlush?: boolean;
};

/** In-memory store has no env-backed options today. */
export type MemoryStoreConfig = Record<string, never>;

export type PgvectorStoreConfig = {
  /** Connection string for pgvector (maps to `ASKDB_PGVECTOR_URL`). */
  databaseUrl?: string;
  table?: string;
  /**
   * @deprecated Ignored with `rag.embedder: "mock"`, whose vectors are always 64 wide (a load warning
   * says so). With `rag.embedder: "ai"`, use `ai.embedding.dimensions` (translated at load, with a
   * warning). Removed at 1.0.
   */
  dimensions?: string | number;
  /** When unset, {@link flattenAskDbConfig} uses `hnsw`. */
  indexStrategy?: string;
};

// ---------------------------------------------------------------------------
// Introspection configs
// ---------------------------------------------------------------------------

/** All introspection provider-specific configs as optional fields — allows storing multiple provider configs simultaneously. */
export type IntrospectionProviderConfigs = {
  postgres?: {
    /**
     * Postgres connection URL for live introspection (maps to `ASKDB_INTROSPECT_POSTGRES_URL`).
     * When omitted, pass `--url` to `askdb introspect` or set `ASKDB_INTROSPECT_POSTGRES_URL` in env.
     */
    databaseUrl?: string;
  };
  prisma?: {
    /**
     * Path to a `schema.prisma` file or directory containing `.prisma` files.
     * When omitted, `@askdb/prisma` auto-discovers `prisma/schema.prisma` or `schema.prisma`
     * in the project root — no explicit path needed.
     */
    schemaPath?: string;
  };
  mysql?: {
    /**
     * MySQL connection URL (e.g. `mysql://user:pass@host:port/database`).
     * When omitted, pass `--url` to `askdb introspect` or set `ASKDB_INTROSPECT_MYSQL_URL` in env.
     */
    databaseUrl?: string;
  };
  sqlite?: {
    /**
     * Path to a `.db` / `.sqlite` file (or `:memory:` for an empty DB). Required —
     * SQLite has no URL-shaped fallback because `DATABASE_URL` is typically a URL
     * for a network engine.
     */
    file?: string;
  };
  sqlserver?: {
    /**
     * Microsoft SQL Server connection URL (mssql URI form or the equivalent
     * `Server=...;` connection string). When omitted, pass `--url` to `askdb introspect`
     * or set `ASKDB_INTROSPECT_SQLSERVER_URL` in env.
     */
    databaseUrl?: string;
  };
};

/** Discriminated union branch for `introspection` when `provider` is `"postgres"`. */
export type PostgresIntrospectionConfig = {
  provider: "postgres";
  providerConfig?: IntrospectionProviderConfigs;
  /**
   * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
   * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
   */
  outputDir?: string;
  /**
   * Schemas to introspect, like `askdb introspect --schemas` (which overrides it), e.g.
   * `["public", "sales"]`. On MySQL/MariaDB these are databases: each becomes its own
   * namespace and cross-database foreign keys are kept; without a list, only the
   * connection URL's database is read, under the `public` namespace. On Postgres and SQL
   * Server, the default is every non-system schema.
   */
  schemas?: string[];
};

/** Discriminated union branch for `introspection` when `provider` is `"prisma"`. */
export type PrismaIntrospectionConfig = {
  provider: "prisma";
  providerConfig?: IntrospectionProviderConfigs;
  /**
   * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
   * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
   */
  outputDir?: string;
  /**
   * Schemas to introspect, like `askdb introspect --schemas` (which overrides it), e.g.
   * `["public", "sales"]`. On MySQL/MariaDB these are databases: each becomes its own
   * namespace and cross-database foreign keys are kept; without a list, only the
   * connection URL's database is read, under the `public` namespace. On Postgres and SQL
   * Server, the default is every non-system schema.
   */
  schemas?: string[];
};

/** Discriminated union branch for `introspection` when `provider` is `"mysql"`. */
export type MysqlIntrospectionConfig = {
  provider: "mysql";
  providerConfig?: IntrospectionProviderConfigs;
  /**
   * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
   * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
   */
  outputDir?: string;
  /**
   * Schemas to introspect, like `askdb introspect --schemas` (which overrides it), e.g.
   * `["public", "sales"]`. On MySQL/MariaDB these are databases: each becomes its own
   * namespace and cross-database foreign keys are kept; without a list, only the
   * connection URL's database is read, under the `public` namespace. On Postgres and SQL
   * Server, the default is every non-system schema.
   */
  schemas?: string[];
};

/** Discriminated union branch for `introspection` when `provider` is `"sqlite"`. */
export type SqliteIntrospectionConfig = {
  provider: "sqlite";
  providerConfig?: IntrospectionProviderConfigs;
  /**
   * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
   * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
   */
  outputDir?: string;
  /**
   * Schemas to introspect, like `askdb introspect --schemas` (which overrides it), e.g.
   * `["public", "sales"]`. On MySQL/MariaDB these are databases: each becomes its own
   * namespace and cross-database foreign keys are kept; without a list, only the
   * connection URL's database is read, under the `public` namespace. On Postgres and SQL
   * Server, the default is every non-system schema.
   */
  schemas?: string[];
};

/** Discriminated union branch for `introspection` when `provider` is `"sqlserver"`. */
export type SqlServerIntrospectionConfig = {
  provider: "sqlserver";
  providerConfig?: IntrospectionProviderConfigs;
  /**
   * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
   * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
   */
  outputDir?: string;
  /**
   * Schemas to introspect, like `askdb introspect --schemas` (which overrides it), e.g.
   * `["public", "sales"]`. On MySQL/MariaDB these are databases: each becomes its own
   * namespace and cross-database foreign keys are kept; without a list, only the
   * connection URL's database is read, under the `public` namespace. On Postgres and SQL
   * Server, the default is every non-system schema.
   */
  schemas?: string[];
};

/** Discriminated union of all supported introspection provider branches. */
export type AskDbIntrospectionConfig =
  | PostgresIntrospectionConfig
  | PrismaIntrospectionConfig
  | MysqlIntrospectionConfig
  | SqliteIntrospectionConfig
  | SqlServerIntrospectionConfig;

// ---------------------------------------------------------------------------
// Root config
// ---------------------------------------------------------------------------

/**
 * Root shape for `export default defineConfig({ ... })` in `askdb.config.*`.
 *
 * - **`ai`**: provider connections (`providerConfig`) plus the `language` and `embedding` model sections.
 * - **`introspection`**: target engine for `askdb introspect` (postgres / prisma / mysql / sqlite / sqlserver) — selecting `provider` determines which `providerConfig` branch is valid. Each branch holds the connection URL/path for that engine.
 * - **`rag`** (optional): the embedder (`"mock"`, or `"ai"` for `ai.embedding`) and the vector store, flattened to `ASKDB_RAG_*` / `ASKDB_PGVECTOR_URL` / file paths. Omitting it means the mock embedder and the in-memory store.
 * - **`logging` | `modes` | `host`**: optional operational defaults.
 */
export type AskDbConfig = {
  ai: AskDbAiConfig;

  introspection: AskDbIntrospectionConfig;

  /**
   * Override the NL→SQL dialect. When unset, the dialect is inferred from the
   * introspection provider (or, for Prisma, from the detected `datasource.provider`).
   * Use this when the inferred dialect is wrong — e.g. Prisma `schema.prisma` declares
   * `provider = "postgresql"` but you actually target a different engine.
   *
   * Keep aligned with `DialectId` in `@askdb/core`. Shipped specs: see `ASKDB_DIALECTS`.
   */
  dialect?: AskDbDialectId;

  /**
   * Retrieval (RAG): the embedder and the vector store. Optional: omit it when you don't use
   * retrieval, and AskDB behaves as if `{ embedder: "mock", store: "memory", storeConfig: {} }`
   * were set, so no store keys are written. Setting `ai.embedding` without it is an error, since
   * nothing would use that model. When present, `embedder`, `store` and `storeConfig` are required.
   */
  rag?: {
    /** `"mock"` (a local lexical embedder) or `"ai"` (the `ai.embedding` model). `"openai"` and `"ai-sdk"` are deprecated. */
    embedder: AskDbRagEmbedder;
    /** @deprecated Use `ai.embedding` and a connection in `ai.providerConfig`. Translated at load (with a warning); removed at 1.0. */
    embedderConfig?: {
      openai?: OpenaiRagEmbedderConfig;
    };
    store: AskDbRagStore;
    storeConfig: {
      file?: FileStoreConfig;
      memory?: MemoryStoreConfig;
      pgvector?: PgvectorStoreConfig;
    };
  };

  logging?: {
    level?: AskDbLogLevel;
    correlationId?: string;
    /** Maps to `ASKDB_LOG_FILE`. */
    logFile?: string;
    /** When true, maps to `ASKDB_LOG_STDOUT=true`. */
    logStdout?: boolean;
  };
  modes?: { askdbMode?: AskDbModeV1; omitSensitiveFromPrompt?: boolean };
  host?: { schemaPath?: string; schemaJson?: string };

  /** Deterministic NL→SQL for tests / local dev (maps to `ASKDB_MOCK_SQL`). */
  dev?: { mockSql?: string };

  /** Studio browser server listen and query-execution defaults. */
  studio?: {
    listen?: { host?: string; port?: number };
    /**
     * Query execution against a live database from the Studio playground.
     * Off by default — set `enabled: true` and give Studio its own connection
     * (ideally a read-only database role).
     */
    execute?: {
      /**
       * Turn on `POST /api/execute` and the Playground's **Execute Query** button.
       * Default `false`: Studio generates SQL but never runs it.
       * Maps to `ASKDB_STUDIO_EXECUTE_ENABLED`.
       */
      enabled?: boolean;
      /**
       * Reuse the introspection connection (`introspection.providerConfig.<engine>`)
       * when `databaseUrl` / `file` is not set. Default `false` — Studio execute needs
       * its own explicit connection so introspection credentials are never used to run
       * ad-hoc SQL by accident. Maps to `ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION`.
       */
      useIntrospectionConnection?: boolean;
      /**
       * Per-query timeout in milliseconds (positive integer). Default `30000`.
       * Enforced server-side on Postgres, MySQL/MariaDB, and SQL Server; not enforced
       * for SQLite. Maps to `ASKDB_STUDIO_EXECUTE_TIMEOUT_MS`.
       */
      timeoutMs?: number;
      /**
       * Maximum rows returned per query (positive integer). Default `500`. Studio fetches
       * at most `maxRows + 1` rows and reports `truncated: true` when more exist.
       * Maps to `ASKDB_STUDIO_EXECUTE_MAX_ROWS`.
       */
      maxRows?: number;
      /**
       * Explicit live-execute provider. When omitted, Studio falls back to the active
       * introspection provider when it is a live engine, then defaults to `"postgres"`.
       * Maps to `ASKDB_STUDIO_EXECUTE_PROVIDER`.
       */
      provider?: AskDbStudioExecuteProvider;
      /** Connection URL used by `POST /api/execute` for network databases (maps to `ASKDB_STUDIO_DATABASE_URL`). */
      databaseUrl?: string;
      /**
       * SQLite file path used by `POST /api/execute` when `provider === "sqlite"`.
       * Maps to `ASKDB_STUDIO_SQLITE_FILE`.
       */
      file?: string;
    };
  };

  /** HTTP API server defaults (first-party `apps/http-api`). */
  httpApi?: {
    listen?: {
      /** When unset, servers default to `3000`. Use `env("PORT")` for platforms that inject `PORT`. */
      port?: number;
      host?: string;
    };
    /**
     * Accept a per-request `schemaJson` override on `POST /ask`. Default `false`: an override
     * lets any caller send arbitrary schema/prompt content through the server's model key, so
     * enable it only for tests or trusted multi-schema deployments.
     * Maps to `ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE`.
     */
    allowSchemaOverride?: boolean;
    /**
     * Abort the model call for a `POST /ask` request after this many milliseconds (positive
     * integer, at most `2147483647`, the Node timer maximum; larger values are a config error).
     * Default `60000`. Maps to `ASKDB_HTTP_REQUEST_TIMEOUT_MS`.
     */
    requestTimeoutMs?: number;
  };
};
