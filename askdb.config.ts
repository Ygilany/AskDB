import "dotenv/config";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

// `dotenv/config` loads a local `.env` when this module runs (missing file is OK).
// CLIs also call `bootstrapAskDbEnv`, which loads `.env` then merges this config into `process.env`.
// Use `env("VAR")` for every value read from the environment; `flattenAskDbConfig` applies defaults
// for optional fields (see `@askdb/config` / `defaults.ts`).
export default defineConfig({
  ai: {
    // openai | azure | foundry (foundry uses Azure-compatible env vars)
    provider: "openai",
    providerConfig: {
      openai: {
        // Live NL→SQL: set in `.env`, e.g. OPENAI_API_KEY=… (optional OPENAI_BASE_URL=…)
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),
      },
      azure: {
        apiKey: env("AZURE_OPENAI_API_KEY"),
        secondaryApiKey: env("AZURE_OPENAI_API_KEY_SECONDARY"),
        model: env("AZURE_OPENAI_DEPLOYMENT"),
        apiVersion: env("AZURE_OPENAI_API_VERSION"),
        baseUrl: env("AZURE_OPENAI_BASE_URL"),
      },
    },
  },

  database: {
    // postgres (more dialects later)
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL — DATABASE_URL (e.g. CI), else `process.env.DATABASE_URL`, else local default in flatten
        // Pagila fixture (docker compose -f fixtures/pagila/docker-compose.yml …): often port 5433
        databaseUrl: env("DATABASE_URL"),
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
    embedder: "openai",
    embedderConfig: {
      openai: {
        model: env("ASKDB_RAG_EMBEDDER_MODEL"),
        dimension: env("ASKDB_RAG_EMBEDDER_DIMENSIONS"),
        apiKey: env("OPENAI_API_KEY"),
        baseUrl: env("ASKDB_RAG_EMBEDDER_BASE_URL"),
      },
    },
    // file | memory | pgvector — optional: ASKDB_PGVECTOR_URL for pgvector (e.g. port 5434 fixture)
    store: "file",
    storeConfig: {
      file: {},
      memory: {},
      pgvector: {
        databaseUrl: env("ASKDB_PGVECTOR_URL"),
        dimensions: env("ASKDB_RAG_EMBEDDER_DIMENSIONS"),
      },
    },
  },
} satisfies AskDbConfig);
