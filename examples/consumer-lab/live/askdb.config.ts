import { defineConfig, env, type AskDbConfig } from "@askdb/config";

/**
 * Live mode's AskDB config (`LAB_LIVE_MODEL=1`, `test/live.test.ts`): the adapter path to the
 * real OpenAI API, as an outside project would configure it (`reference/config.mdx`). It lives
 * apart from the lab's `askdb.config.ts` so the CLI, HTTP API and Studio suites, which read that
 * one, always reach the replay server and never see a key.
 *
 * The key is read from OPENAI_API_KEY, which live mode sets from the shell or `.env.live`
 * before loading this file. No base URL: the adapter's default, api.openai.com. The model is
 * AskDB's OpenAI default unless LAB_LIVE_MODEL_ID asks for another; it is then set as
 * `ai.language.model`, which every release since askdb 1.0.0-beta.44 reads. A connection's own
 * `model`, which earlier releases read, fails to load since 1.0.0-beta.50 (#765).
 */
const model = process.env.LAB_LIVE_MODEL_ID;

export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: env("OPENAI_API_KEY") },
    },
    ...(model ? { language: { model } } : {}),
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: {} },
    outputDir: "../.lab/artifacts",
  },
  rag: {
    embedder: "mock",
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
