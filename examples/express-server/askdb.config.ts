import { defineConfig, env, type AskDbConfig } from "@askdb/config";

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: {
        apiKey: env("OPENAI_API_KEY"),
        model: env("OPENAI_MODEL"), // optional — defaults to gpt-4o-mini
      },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: {
      postgres: { databaseUrl: env("DATABASE_URL") },
    },
  },
  host: {
    // Path to the schema artifact produced by `askdb introspect`.
    // Set ASKDB_SCHEMA_PATH in .env or the system environment.
    schemaPath: env("ASKDB_SCHEMA_PATH"),
  },
} satisfies AskDbConfig);
