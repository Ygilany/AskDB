/**
 * The raw-model path to the replay server: a Vercel AI SDK `LanguageModel` from
 * `createOpenAI({ baseURL })`, passed to `ask()` from `@askdb/core` (`reference/core-api.mdx`,
 * `guides/bring-your-own-model.mdx`). Used by `pnpm lab ask` and by the suites that need
 * `ask()`'s whole result, not only its SQL. Also the live model on either path
 * (`liveModel`, `useLiveConfig`), for `lab ask --model live`, `lab ui` and the live suite.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { bootstrapAskDbEnv } from "@askdb/config";
import { ask, loadSchema, type AskGenerateDeps } from "@askdb/core";
import { join } from "node:path";
import type { SupportedDialect } from "./dialects.js";
import { DEFAULT_LIVE_MODEL_ID, type LiveSettings } from "./model/live.js";
import { replyText } from "./model/openai-wire.js";
import { LAB_ROOT } from "./paths.js";
import type { ResolveTenantDescendants } from "./tenant.js";

/** The model id sent to the replay server. The lab's configs leave the model unset, and AskDB's OpenAI default is this same id. */
export const MODEL_ID = "gpt-4o-mini";
/** The replay server ignores it; the OpenAI client requires one. */
export const API_KEY = "lab-replay-no-key";

export type AskResult = Awaited<ReturnType<typeof ask>>;

/** `ask()`'s outcome as a value: its result, or what it threw. */
export type Settled = { ok: true; result: AskResult } | { ok: false; error: unknown };
export const settle = (p: Promise<AskResult>): Promise<Settled> =>
  p.then((result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }));
type AskOptions = Parameters<typeof ask>[0];
/**
 * Further `ask()` options, such as `tenantScope` and `tenantSqlMode`. `resolveTenantDescendants`
 * is spelled out so the lab typechecks against a target from before the option existed.
 */
export type AskExtras = Omit<AskOptions, "question" | "schema" | "model" | "dialect"> & { resolveTenantDescendants?: ResolveTenantDescendants };

/** `ask()` with a raw `LanguageModel` pointed at `baseURL`, the replay server's base URL for `dialect`. */
export async function askRaw(dialect: SupportedDialect, question: string, schemaDir: string, baseURL: string, extras: AskExtras = {}): Promise<AskResult> {
  const openai = createOpenAI({ baseURL, apiKey: API_KEY });
  return askWithModel(dialect, question, schemaDir, openai(MODEL_ID), extras);
}

/** `ask()` with any raw `LanguageModel`: the replay server's, the recording proxy's, or a live provider's. */
export async function askWithModel(dialect: SupportedDialect, question: string, schemaDir: string, model: AskOptions["model"], extras: AskExtras = {}): Promise<AskResult> {
  return ask({ ...extras, question, schema: loadSchema(schemaDir), model, dialect } as AskOptions);
}

/**
 * The live model on the raw path, `createOpenAI({ apiKey })`, and the reply it last gave, read
 * through the AI SDK's documented `fetch` option: a rejection carries no SQL, so the reply is
 * what shows why.
 */
export function liveModel(live: LiveSettings): { model: AskOptions["model"]; reply: () => string | null } {
  let reply: string | null = null;
  const openai = createOpenAI({
    apiKey: live.apiKey,
    baseURL: live.baseURL,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      reply = replyText((await response.clone().json().catch(() => ({}))) as Record<string, unknown>);
      return response;
    },
  });
  return { model: openai(live.modelId), reply: () => reply };
}

/** Live mode's AskDB config, apart from the lab's own `askdb.config.ts` so no other surface sees a key. */
export const LIVE_PROJECT = join(LAB_ROOT, "live");

/**
 * Point the adapter path (`createAskDb` from config) at the live model: `live/askdb.config.ts`,
 * which reads OPENAI_API_KEY and LAB_LIVE_MODEL_ID. Both go in this process's environment, so
 * only a process that asks once and ends (`lab ask`, a `lab ui` engine run, the live suite's
 * worker) may call it. LAB_LIVE_MODEL_ID is set only for a model other than the default, so
 * the config's deprecated `model` key stays unset otherwise, and is cleared for the default,
 * so a padded or blank one `liveSettings` read past doesn't reach the config.
 */
export function useLiveConfig(live: LiveSettings): void {
  process.env.OPENAI_API_KEY = live.apiKey;
  if (live.modelId === DEFAULT_LIVE_MODEL_ID) delete process.env.LAB_LIVE_MODEL_ID;
  else process.env.LAB_LIVE_MODEL_ID = live.modelId;
  bootstrapAskDbEnv({ cwd: LIVE_PROJECT });
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
