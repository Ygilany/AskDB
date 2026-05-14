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
 * passed to {@link defineConfig} in `askdb.config.*`, then flattened to canonical `process.env` keys.
 *
 * Use with TypeScript’s `satisfies` operator to validate the object literal without widening it, e.g.
 * `defineConfig({ ... } satisfies AskDbConfig)` or `const cfg = { ... } satisfies AskDbConfig`.
 *
 * @see {@link AskDbEnvConfig} for the legacy flat merge shape.
 */
export type OpenaiConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

export type AzureConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  apiVersion?: string;
};

export type FoundryConfig = {
  apiKey: string;
  secondaryApiKey?: string;
  model: string;
  apiVersion?: string;
  baseUrl?: string;
};

/** Placeholder for future providers — not flattened today. */
export type AnthropicConfig = Record<string, never>;
export type GoogleConfig = Record<string, never>;

export type OpenaiRagEmbedderConfig = {
  model: string;
  dimension: number;
  apiKey: string;
  baseUrl?: string;
};

export type FileStoreConfig = {
  /** Passed to `createFileStore({ basePath })` — vector files use `<basePath>.embeddings.*`. */
  basePath: string;
  autoFlush?: boolean;
};

/** In-memory store has no env-backed options today. */
export type MemoryStoreConfig = Record<string, never>;

export type PgvectorStoreConfig = {
  /** Connection string for pgvector (maps to `ASKDB_PGVECTOR_URL`). */
  databaseUrl: string;
  table?: string;
  dimensions: number;
  indexStrategy?: "ivfflat" | "hnsw" | "none";
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
      postgres: { databaseUrl: string };
    };
  };

  introspection: {
    provider: AskDbIntrospectionProvider;
    providerConfig: {
      postgres?: {
        /**
         * When omitted or blank, `flattenAskDbConfig` leaves `DATABASE_URL` as the value from
         * `database.providerConfig.postgres.databaseUrl`. Set this only for an introspection-only URL.
         */
        databaseUrl?: string;
      };
      prisma?: {
        schemaPath?: string;
      };
    };
    /** Default introspection output directory (maps to `ASKDB_INTROSPECT_OUT`). */
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

  logging?: { level?: AskDbLogLevel; correlationId?: string };
  modes?: { askdbMode?: AskDbModeV1; omitSensitiveFromPrompt?: boolean };
  host?: { schemaPath?: string; schemaJson?: string };
};

/**
 * Legacy flat map: canonical `process.env` key → resolved string value.
 * Used only for `export default { OPENAI_API_KEY: "…", … }` merge compatibility.
 * Prefer {@link AskDbConfig} with {@link defineConfig}.
 */
export type AskDbEnvConfig = Record<string, string>;
