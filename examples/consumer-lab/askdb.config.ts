import { defineConfig, type AskDbConfig } from "@askdb/config";

/**
 * The lab's own AskDB config, as an outside project would have (the `askdb` CLI requires
 * one). The lab passes connection URLs on the command line, so nothing here points at a
 * real database or model.
 */
export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: { openai: { apiKey: "", model: "gpt-4o-mini" } },
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
