import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: env("OPENAI_API_KEY") },
    },
    language: { model: env("OPENAI_MODEL") }, // optional — defaults to gpt-4o-mini
  },
  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: { databaseUrl: env("DATABASE_URL") },
    },
  },
  host: {
    // Path to the schema artifact produced by `askdb introspect`.
    // Set SCHEMA_PATH in .env or the system environment.
    schemaPath: env("SCHEMA_PATH"),
  },
} satisfies AskDbConfig);
