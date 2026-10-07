import { defineConfig, env, type AskDbConfig } from "@askdb/config";

/**
 * Live mode's AskDB config (`LAB_LIVE_MODEL=1`, `test/live.test.ts`): the adapter path to the
 * real OpenAI API, as an outside project would configure it (`reference/config.mdx`). It lives
 * apart from the lab's `askdb.config.ts` so the CLI, HTTP API and Studio suites, which read that
 * one, always reach the replay server and never see a key.
 *
 * The key is read from OPENAI_API_KEY, which live mode sets from the shell or `.env.live`
 * before loading this file. No base URL: the adapter's default, api.openai.com. The model is
 * AskDB's OpenAI default unless LAB_LIVE_MODEL_ID asks for another; it is then set with the
 * connection's `model`, which every release the lab targets reads (deprecated on `main` in
 * favour of `ai.language.model`, which older releases don't have, so it warns there).
 */
const model = process.env.LAB_LIVE_MODEL_ID;

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: env("OPENAI_API_KEY"), ...(model ? { model } : {}) },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: {} },
    outputDir: "../.lab/artifacts",
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
