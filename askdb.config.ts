import { defineConfig, env, type AskDbConfig } from "@askdb/config";

// CLIs call `bootstrapAskDbEnv`, which loads `.env` (a missing file is OK), then evaluates this file and
// installs the AskDB runtime snapshot, so this file doesn't load `.env` itself.
// Use `env("VAR")` for every value read from the environment; `flattenAskDbConfig` applies defaults
// for optional fields (see `@askdb/config` / `defaults.ts`).
export default defineConfig({
  ai: {
    // openai | azure | foundry | anthropic | google | gateway — the default provider for both sections below
    provider: "openai",
    // Provider connections only (keys, endpoints). A provider can list several, each with a `name`.
    providerConfig: {
      openai: {
        // Live NL→SQL: set in `.env`, e.g. OPENAI_API_KEY=… (optional OPENAI_BASE_URL=…)
        apiKey: env("OPENAI_API_KEY"),
      },
    },
    // The language model (NL→SQL, enrichment suggestions). Unset: the provider's default.
    language: {
      model: env("OPENAI_MODEL"),
    },
    // The embedding model behind `rag.embedder: "ai"`, on the openai connection above. To embed
    // with another provider or key, set `provider` / `connection` here and add that connection.
    embedding: {
      model: env("ASKDB_RAG_EMBEDDER_MODEL") ?? "text-embedding-3-small",
      // Optional: a vector size to request. Unset, AskDB uses the width the model returns.
      dimensions: env("ASKDB_RAG_EMBEDDER_DIMENSIONS"),
    },
  },

  introspection: {
    // postgres | prisma | mysql | sqlite | sqlserver
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL for `askdb introspect` — maps to ASKDB_INTROSPECT_POSTGRES_URL
        // Multi-engine fixture (`pnpm fixture:up`): postgres://fixture_reader:fixture_reader@127.0.0.1:15432/askdb_fixture
        databaseUrl: env("DATABASE_URL"),
      },
    },
    // Default Schema v2 output when you omit `askdb introspect --out` (maps to ASKDB_INTROSPECT_OUT)
    outputDir: env("MY_INTROSPECT_OUTPUT_DIR"),
  },

  rag: {
    // mock (local lexical, no AI) | ai (the `ai.embedding` model)
    embedder: "ai",
    // file | memory | pgvector — optional: ASKDB_PGVECTOR_URL for pgvector (e.g. port 5434 fixture)
    store: "file",
    storeConfig: {
      file: {},
      memory: {},
      pgvector: {
        databaseUrl: env("ASKDB_PGVECTOR_URL"),
      },
    },
  },
  logging: {
    correlationId: env("ASKDB_CORRELATION_ID"),
  },
  dev: {
    mockSql: env("ASKDB_MOCK_SQL"),
  },
  studio: {
    listen: {
      host: env("ASKDB_STUDIO_HOST"),
      ...(env("ASKDB_STUDIO_PORT") ? { port: Number(env("ASKDB_STUDIO_PORT")) } : {}),
    },
    execute: {
      // Studio execute is opt-in; this repo's dev setup turns it on.
      enabled: true,
      // Connection URL for the Studio playground query runner (maps to ASKDB_STUDIO_DATABASE_URL)
      databaseUrl: env("DATABASE_URL"),
    },
  },
  httpApi: {
    listen: {
      host: env("HOST"),
      ...(env("PORT") ? { port: Number(env("PORT")) } : {}),
    },
  },
} satisfies AskDbConfig);
