import "dotenv/config";
import { defineConfig, optionalEnv, type AskDbConfig } from "@askdb/config";

// `dotenv/config` loads a local `.env` when this module runs (missing file is OK).
// CLIs also call `bootstrapAskDbEnv`, which loads `.env` then merges this config into `process.env`.
// Use `optionalEnv` for values that must exist at file load time (CI clones); use `env` from `@askdb/config` for fail-fast once you rely on `.env`.
export default defineConfig({
  ai: {
    // openai | azure | foundry (foundry uses Azure-compatible env vars)
    provider: "openai",
    providerConfig: {
      openai: {
        // Live NL→SQL: set in `.env`, e.g. MY_OPENAI_API_KEY=… (optional MY_OPENAI_BASE_URL=…)
        apiKey: "",
        // Chat model id — override with MY_CHAT_MODEL in `.env` if needed
        model: optionalEnv("MY_CHAT_MODEL", "gpt-4o-mini"),
      },
    },
  },

  database: {
    // postgres (more dialects later)
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL — MY_DATABASE_URL, else DATABASE_URL (e.g. CI), else local default
        // Pagila fixture (docker compose -f fixtures/pagila/docker-compose.yml …): often port 5433
        databaseUrl: optionalEnv(
          "MY_DATABASE_URL",
          process.env.DATABASE_URL?.trim() ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres",
        ),
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
    outputDir: optionalEnv("MY_INTROSPECT_OUTPUT_DIR", "./askdb/"),
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
