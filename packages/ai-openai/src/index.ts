import { createOpenAI } from "@ai-sdk/openai";
import {
  resolveBaseConfig,
  withEmbeddingProviderOptions,
  type AiProviderAdapter,
  type ProviderEnvSpec,
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
 * Whether a model id belongs to a family that accepts `reasoningEffort`:
 * the o-series and gpt-5+ — except the `-chat` variants
 * (e.g. `gpt-5-chat-latest`), which are non-reasoning chat models. Mirrors
 * `getOpenAILanguageModelCapabilities` in `@ai-sdk/openai`, but conservatively
 * excludes every `-chat` variant (including minor versions such as
 * `gpt-5.1-chat-latest`) so AskDB never sends a reasoning knob a chat model
 * might reject.
 */
function isReasoningModel(model: string): boolean {
  if (O_SERIES_PATTERN.test(model)) return true;
  const gpt = GPT_VERSION_PATTERN.exec(model);
  if (!gpt) return false;
  if (Number(gpt[1]) < 5) return false;
  return !(gpt[2]?.toLowerCase().startsWith("chat") ?? false);
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
    if (!reasoningEffort || !isReasoningModel(config.model)) return undefined;
    return { openai: { reasoningEffort } };
  },
};
