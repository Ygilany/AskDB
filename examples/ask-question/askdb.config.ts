import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
      },
    },
    language: {
      model: env("OPENAI_MODEL"),
    },
    embedding: {
      model: env("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: { databaseUrl: env("DATABASE_URL") },
    },
  },
  rag: {
    embedder: "ai",
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
