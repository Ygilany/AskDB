/**
 * The raw-model path to the replay server: a Vercel AI SDK `LanguageModel` from
 * `createOpenAI({ baseURL })`, passed to `ask()` from `@askdb/core` (`reference/core-api.mdx`,
 * `guides/bring-your-own-model.mdx`). Used by `pnpm lab ask` and by the suites that need
 * `ask()`'s whole result, not only its SQL.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { ask, loadSchema, type AskGenerateDeps } from "@askdb/core";
import type { SupportedDialect } from "./dialects.js";
import type { ResolveTenantDescendants } from "./tenant.js";

/** The model id sent to the replay server; the same as the config's `providerConfig.openai.model`. */
export const MODEL_ID = "gpt-4o-mini";
/** The replay server ignores it; the OpenAI client requires one. */
export const API_KEY = "lab-replay-no-key";

export type AskResult = Awaited<ReturnType<typeof ask>>;
type AskOptions = Parameters<typeof ask>[0];
/**
 * Further `ask()` options, such as `tenantScope` and `tenantSqlMode`. `resolveTenantDescendants`
 * is spelled out so the lab typechecks against a target from before the option existed.
 */
export type AskExtras = Omit<AskOptions, "question" | "schema" | "model" | "dialect"> & { resolveTenantDescendants?: ResolveTenantDescendants };

/** `ask()` with a raw `LanguageModel` pointed at `baseURL`, the replay server's base URL for `dialect`. */
export async function askRaw(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string, extras: AskExtras = {}): Promise<AskResult> {
  const openai = createOpenAI({ baseURL, apiKey: API_KEY });
  return ask({ ...extras, question, schema: loadSchema(schemaDir), model: openai(MODEL_ID), dialect } as AskOptions);
}

/**
 * The documented `deps.generateText` seam: a "model" that always answers with this SQL,
 * fenced the way a model reply is.
 */
function fixedSqlReply(sql: string): NonNullable<AskGenerateDeps["generateText"]> {
  // Only `text` is read from a generateText result on this path.
  return (async () => ({ text: `\`\`\`sql\n${sql}\n\`\`\`` })) as unknown as NonNullable<AskGenerateDeps["generateText"]>;
}

/**
 * `ask()` with `sql` as the model's reply, through `deps.generateText`: what `lab ask --sql`
 * runs, and how the safety suite delivers an attacker's reply. No model is called.
 */
export async function askFixedSql(dialect: SupportedDialect, sql: string, schemaDir: string, question = "Run the SQL supplied with --sql."): Promise<AskResult> {
  // `model` is required; with `deps.generateText` supplied it is never called.
  const model = {} as Parameters<typeof ask>[0]["model"];
  return ask({ question, schema: loadSchema(schemaDir), model, dialect, deps: { generateText: fixedSqlReply(sql) } });
}
