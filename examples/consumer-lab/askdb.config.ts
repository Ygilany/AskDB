import { defineConfig, env, type AskDbConfig } from "@askdb/config";

/**
 * The lab's own AskDB config, as an outside project would have (the `askdb` CLI requires
 * one). The lab passes connection URLs on the command line, so nothing here points at a
 * real database.
 *
 * The model is the lab's replay server. `pnpm lab ask` starts it and sets
 * LAB_REPLAY_BASE_URL to its per-dialect base URL (`http://127.0.0.1:<port>/<dialect>/v1`),
 * which is how the documented `openai` provider reaches any OpenAI-compatible endpoint.
 * The replay server ignores the API key.
 */
export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: "lab-replay-no-key", baseUrl: env("LAB_REPLAY_BASE_URL"), model: "gpt-4o-mini" },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: {} },
    outputDir: "./.lab/artifacts",
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
