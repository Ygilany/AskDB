import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"),
      },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: { databaseUrl: env("DATABASE_URL") },
    },
  },
  rag: {
    embedder: "openai",
    embedderConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_EMBEDDING_MODEL"),
      },
    },
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
