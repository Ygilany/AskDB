import type {
  AskDbDialectId,
  AskDbLogLevel,
  AskDbModeV1,
  AskDbRagEmbedder,
  AskDbRagStore,
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
// AI provider configs
// ---------------------------------------------------------------------------

export type OpenaiConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** When unset, `flattenAskDbConfig` applies the default OpenAI chat model (see `@askdb/config` defaults). */
  model?: string;
};

export type AzureConfig = {
  apiKey?: string;
  secondaryApiKey?: string;
  baseUrl?: string;
  /** When unset, `flattenAskDbConfig` applies the default Azure deployment name (see `@askdb/config` defaults). */
  model?: string;
  apiVersion?: string;
};

export type FoundryConfig = {
  apiKey?: string;
  secondaryApiKey?: string;
  model?: string;
  apiVersion?: string;
  baseUrl?: string;
};

export type AnthropicConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** When unset, `flattenAskDbConfig` applies the default Anthropic chat model (see `@askdb/config` defaults). */
  model?: string;
};

export type GoogleConfig = {
  apiKey?: string;
  baseUrl?: string;
  /** When unset, `flattenAskDbConfig` applies the default Gemini chat model (see `@askdb/config` defaults). */
  model?: string;
};

/** All provider-specific configs as optional fields — intersected per-branch to require only the active provider's key. */
export type AiProviderConfigs = {
  openai?: OpenaiConfig;
  azure?: AzureConfig;
  foundry?: FoundryConfig;
  anthropic?: AnthropicConfig;
  google?: GoogleConfig;
};

/** Discriminated union branch for `ai` when `provider` is `"openai"`. */
export type OpenaiAiConfig = {
  provider: "openai";
  providerConfig: AiProviderConfigs & { openai: OpenaiConfig };
};

/** Discriminated union branch for `ai` when `provider` is `"azure"`. */
export type AzureAiConfig = {
  provider: "azure";
  providerConfig: AiProviderConfigs & { azure: AzureConfig };
};

/** Discriminated union branch for `ai` when `provider` is `"foundry"`. */
export type FoundryAiConfig = {
  provider: "foundry";
  providerConfig: AiProviderConfigs & { foundry: FoundryConfig };
};

/** Discriminated union branch for `ai` when `provider` is `"anthropic"`. */
export type AnthropicAiConfig = {
  provider: "anthropic";
  providerConfig: AiProviderConfigs & { anthropic: AnthropicConfig };
};

/** Discriminated union branch for `ai` when `provider` is `"google"`. */
export type GoogleAiConfig = {
  provider: "google";
  providerConfig: AiProviderConfigs & { google: GoogleConfig };
};

/** Generic connection settings for a provider AskDB has no dedicated branch for.
 *  Flattened to the universal ASKDB_AI_* keys; works end to end only when the
 *  consuming registry has an adapter registered under this provider name. */
export type CustomProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

/** Branch for custom/third-party providers. `(string & {})` preserves literal
 *  autocomplete for the known providers while accepting any other string. */
export type CustomAiConfig = {
  /** Any provider string not covered by a first-party branch. Works end to end
   *  only when the host registry has an adapter registered under this name.
   *  See the three-tier model: known literal (zero code) → custom string + registered
   *  adapter (~40 lines) → BYO `LanguageModel` via `ask({ model })` (no config). */
  provider: string & {};
  providerConfig?: { custom?: CustomProviderConfig };
};

/** Discriminated union of all supported AI provider branches plus the generic
 *  custom-provider escape hatch for third-party or host-registered adapters. */
export type AskDbAiConfig =
  | OpenaiAiConfig
  | AzureAiConfig
  | FoundryAiConfig
  | AnthropicAiConfig
  | GoogleAiConfig
  | CustomAiConfig;

// ---------------------------------------------------------------------------
// RAG configs
// ---------------------------------------------------------------------------

export type OpenaiRagEmbedderConfig = {
  model?: string;
  /** Raw env string or number; positive integer parsed in {@link flattenAskDbConfig}, else derived from `model`. */
  dimension?: string | number;
  apiKey?: string;
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
  /** Positive integer from env or number; when unset, matches resolved RAG embedder dimensions in {@link flattenAskDbConfig}. */
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
 * - **`ai`**: LLM provider discriminated union — selecting `provider` determines which `providerConfig` branch is required.
 * - **`introspection`**: target engine for `askdb introspect` (postgres / prisma / mysql / sqlite / sqlserver) — selecting `provider` determines which `providerConfig` branch is valid. Each branch holds the connection URL/path for that engine.
 * - **`rag`**: embedder + store branches flattened to `ASKDB_RAG_*` / `ASKDB_PGVECTOR_URL` / file paths.
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

  rag: {
    embedder: AskDbRagEmbedder;
    embedderConfig: {
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
    /** Query execution against a live database from the Studio playground. */
    execute?: {
      /** Connection URL used by `POST /api/execute` (maps to `ASKDB_STUDIO_DATABASE_URL`). */
      databaseUrl?: string;
    };
  };

  /** HTTP API server defaults (first-party `apps/http-api`). */
  httpApi?: {
    listen?: {
      /** When unset, servers default to `3000`. Use `env("PORT")` for platforms that inject `PORT`. */
      port?: number;
      host?: string;
    };
  };
};
