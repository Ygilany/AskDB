/**
 * The raw-model path to the replay server: a Vercel AI SDK `LanguageModel` from
 * `createOpenAI({ baseURL })`, passed to `ask()` from `@askdb/core` (`reference/core-api.mdx`,
 * `guides/bring-your-own-model.mdx`). Used by `pnpm lab ask` and by the suites that need
 * `ask()`'s whole result, not only its SQL.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { ask, loadSchema } from "@askdb/core";
import type { SupportedDialect } from "./dialects.js";

/** The model id sent to the replay server; the same as the config's `providerConfig.openai.model`. */
export const MODEL_ID = "gpt-4o-mini";
/** The replay server ignores it; the OpenAI client requires one. */
export const API_KEY = "lab-replay-no-key";

export type AskResult = Awaited<ReturnType<typeof ask>>;

/** `ask()` with a raw `LanguageModel` pointed at `baseURL`, the replay server's base URL for `dialect`. */
export async function askRaw(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string): Promise<AskResult> {
  const openai = createOpenAI({ baseURL, apiKey: API_KEY });
  return ask({ question, schema: loadSchema(schemaDir), model: openai(MODEL_ID), dialect });
}
