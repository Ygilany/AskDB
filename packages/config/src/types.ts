import type {
  AskDbAiProviderId,
  AskDbIntrospectionProvider,
  AskDbLogLevel,
  AskDbModeV1,
  AskDbRagEmbedder,
  AskDbRagStore,
} from "./constants.js";

/**
 * Authoring-time AskDB configuration: nested groups (`ai`, `database`, `introspection`, `rag`, …)
 * passed to {@link defineConfig} in `askdb.config.*`, then flattened to canonical env keys for the runtime snapshot.
 *
 * Use with TypeScript’s `satisfies` operator to validate the object literal without widening it, e.g.
 * `defineConfig({ ... } satisfies AskDbConfig)` or `const cfg = { ... } satisfies AskDbConfig`.
 *
 */
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

/** Placeholder for future providers — not flattened today. */
export type AnthropicConfig = Record<string, never>;
export type GoogleConfig = Record<string, never>;

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

/**
 * Root shape for `export default defineConfig({ ... })` in `askdb.config.*`.
 *
 * - **`ai`**: LLM provider + discriminated `providerConfig` branch (`openai` | `azure` | `foundry`).
 * - **`database`**: primary app DB (Postgres today); supplies default `DATABASE_URL`.
 * - **`introspection`**: Postgres vs Prisma engine; Postgres may omit `databaseUrl` to reuse `database`.
 * - **`rag`**: embedder + store branches flattened to `ASKDB_RAG_*` / `ASKDB_PGVECTOR_URL` / file paths.
 * - **`logging` | `modes` | `host`**: optional operational defaults.
 */
export type AskDbConfig = {
  ai: {
    provider: AskDbAiProviderId;
    providerConfig: {
      openai?: OpenaiConfig;
      azure?: AzureConfig;
      foundry?: FoundryConfig;
      anthropic?: AnthropicConfig;
      google?: GoogleConfig;
    };
  };

  database: {
    provider: "postgres";
    providerConfig: {
      /**
       * When unset/blank, `flattenAskDbConfig` uses the package default local Postgres URL.
       * Use `env("DATABASE_URL")` (or another key) in `askdb.config.*` to supply a URL from `.env`.
       */
      postgres: { databaseUrl?: string };
    };
  };

  introspection: {
    provider: AskDbIntrospectionProvider;
    providerConfig: {
      postgres?: {
        /**
         * When omitted or blank, live introspection reuses the resolved `DATABASE_URL` from the
         * `database` section. Set this only for an introspection-only URL.
         */
        databaseUrl?: string;
      };
      prisma?: {
        schemaPath?: string;
      };
    };
    /**
     * Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`).
     * When unset/blank, `flattenAskDbConfig` uses the package default `./askdb/`.
     */
    outputDir?: string;
  };

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

  /** Default listen options for `askdb-tui` / other CLIs that need a model id. */
  tui?: { model?: string };

  /** Studio browser server and optional RAG overrides. */
  studio?: {
    model?: string;
    listen?: { host?: string; port?: number };
    rag?: {
      embedder?: string;
      dimensions?: string | number;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
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
