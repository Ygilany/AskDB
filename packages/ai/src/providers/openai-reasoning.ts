import type { ReasoningEffort } from "../reasoning.js";

/** o-series: `o1`, `o3`, `o3-mini`, `o4-mini`, … */
const O_SERIES_PATTERN = /^o\d+(?:-|$)/i;
/** `gpt-<major>[.<minor>][-<variant>]`, e.g. `gpt-5`, `gpt-5.1`, `gpt-5-mini`, `gpt-5-chat-latest`. */
const GPT_VERSION_PATTERN = /^gpt-(\d+)(?:\.\d+)?(?:-(.+))?$/i;

/**
 * The `reasoningEffort` to send for an OpenAI model id, or `undefined` when
 * the model doesn't accept one. Shared by the `openai` and `azure` providers,
 * which serve the same models.
 *
 * Reasoning models are the o-series and gpt-5+, except the `-chat` variants
 * (e.g. `gpt-5-chat-latest`), which are non-reasoning chat models. This
 * mirrors `getOpenAILanguageModelCapabilities` in `@ai-sdk/openai`, but
 * conservatively excludes every `-chat` variant (including minor versions such
 * as `gpt-5.1-chat-latest`) so AskDB never sends a reasoning knob a chat model
 * might reject.
 *
 * gpt-6 and later accept `low` through `max` but not `minimal`, so `minimal`
 * becomes `low`, the nearest level they accept.
 */
export function openaiReasoningEffort(
  model: string,
  effort: ReasoningEffort,
): ReasoningEffort | undefined {
  if (O_SERIES_PATTERN.test(model)) return effort;
  const gpt = GPT_VERSION_PATTERN.exec(model);
  if (!gpt) return undefined;
  const major = Number(gpt[1]);
  if (major < 5) return undefined;
  if (gpt[2]?.toLowerCase().startsWith("chat")) return undefined;
  return major >= 6 && effort === "minimal" ? "low" : effort;
}
