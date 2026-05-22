import "dotenv/config";
import { defineConfig, env, type AskDbConfig } from "@askdb/config";

// `dotenv/config` loads a local `.env` when this module runs (missing file is OK).
// CLIs call `bootstrapAskDbEnv`, which loads `.env` then evaluates this file and installs the AskDB runtime snapshot.
// Use `env("VAR")` for every value read from the environment; `flattenAskDbConfig` applies defaults
// for optional fields (see `@askdb/config` / `defaults.ts`).
export default defineConfig({
  ai: {
    // openai | azure | foundry (foundry uses Azure-compatible env vars) | google
    provider: "openai",
    providerConfig: {
      openai: {
        // Live NL→SQL: set in `.env`, e.g. OPENAI_API_KEY=… (optional OPENAI_BASE_URL=…)
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),
      },
    },
  },

  introspection: {
    // postgres | prisma | mysql | sqlite | sqlserver
    provider: "postgres",
    providerConfig: {
      postgres: {
        // Postgres URL for `askdb introspect` — maps to ASKDB_INTROSPECT_POSTGRES_URL
        // Pagila fixture (docker compose -f fixtures/pagila/docker-compose.yml …): often port 5433
        databaseUrl: env("DATABASE_URL"),
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
