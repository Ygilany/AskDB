import { createOpenAI } from "@ai-sdk/openai";
import {
  resolveBaseConfig,
  withEmbeddingProviderOptions,
  type AiProviderAdapter,
  type ProviderEnvSpec,
  type ReasoningEffort,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["OPENAI_API_KEY"],
  apiKeySecondaryVars: ["OPENAI_API_KEY_SECONDARY"],
  modelVars: ["OPENAI_MODEL"],
  embeddingModelVars: ["OPENAI_EMBEDDING_MODEL"],
  baseURLVars: ["OPENAI_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

/** o-series: `o1`, `o3`, `o3-mini`, `o4-mini`, … */
const O_SERIES_PATTERN = /^o\d+(?:-|$)/i;
/** `gpt-<major>[.<minor>][-<variant>]`, e.g. `gpt-5`, `gpt-5.1`, `gpt-5-mini`, `gpt-5-chat-latest`. */
const GPT_VERSION_PATTERN = /^gpt-(\d+)(?:\.\d+)?(?:-(.+))?$/i;

/**
 * The `reasoningEffort` to send for an OpenAI model id, or `undefined` when
 * the model doesn't accept one.
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
 *
 * Duplicated verbatim in `@askdb/ai-azure` (Azure serves the same models): sibling adapters
 * can't import each other, and vendor model knowledge doesn't belong in provider-agnostic
 * `@askdb/ai`. Change both together.
 */
function openaiReasoningEffort(
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

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
  configHint: "For OpenAI, set ai.provider: \"openai\" and ai.providerConfig.openai.apiKey in askdb.config.*.",
  resolveConfig(env, options) {
    return resolveBaseConfig("openai", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return openai(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    const model = openai.embedding(config.model);
    return withEmbeddingProviderOptions(model, "openai", options);
  },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort) return undefined;
    const effort = openaiReasoningEffort(config.model, reasoningEffort);
    return effort ? { openai: { reasoningEffort: effort } } : undefined;
  },
};
