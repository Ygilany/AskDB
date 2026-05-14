import "dotenv/config";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

// `dotenv/config` loads a local `.env` when this module runs (missing file is OK).
// CLIs also call `bootstrapAskDbEnv`, which loads `.env` then merges this config into `process.env`.
// Use `env("VAR")` for required values from the environment; use literals until you wire a key.
export default defineConfig({
  ai: {
    // openai | azure | foundry (foundry uses Azure-compatible env vars)
    provider: "openai",
    providerConfig: {
      openai: {
        // Live NL→SQL: set in `.env`, e.g. MY_OPENAI_API_KEY=… (optional MY_OPENAI_BASE_URL=…)
        apiKey: "",
        // Chat model id — set MY_CHAT_MODEL in `.env` (e.g. gpt-4o-mini)
        model: env("MY_CHAT_MODEL"),
      },
    },
  },

  database: {
    // postgres (more dialects later)
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL for connectors — set MY_DATABASE_URL in `.env`
        // Pagila fixture (docker compose -f fixtures/pagila/docker-compose.yml …): often port 5433
        databaseUrl: env("MY_DATABASE_URL"),
      },
    },
  },

  introspection: {
    // postgres | prisma — for prisma, add a prisma branch and e.g. env("MY_PRISMA_SCHEMA")
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Omit databaseUrl here to reuse database.providerConfig.postgres.databaseUrl (see flattenAskDbConfig).
        // Optional separate introspection URL: set a field here, e.g. databaseUrl: env("MY_INTROSPECT_DATABASE_URL")
      },
    },
    // Default Schema v2 output when you omit `askdb introspect --out` (maps to ASKDB_INTROSPECT_OUT)
    outputDir: env("MY_INTROSPECT_OUTPUT_DIR"),
  },

  rag: {
    // mock | openai | ai-sdk — optional: MY_RAG_EMBEDDER in `.env`
    embedder: "mock",
    embedderConfig: {},
    // file | memory | pgvector — optional: MY_PGVECTOR_URL for pgvector (e.g. port 5434 fixture)
    store: "memory",
    storeConfig: {
      memory: {},
    },
  },
} satisfies AskDbConfig);
