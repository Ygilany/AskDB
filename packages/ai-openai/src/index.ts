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

/** o-series (o1, o3, o3-mini, o4-mini, …) and gpt-5.x — the OpenAI model families that accept `reasoningEffort`. */
const REASONING_MODEL_PATTERN = /^o\d(-|$)|^gpt-5/i;

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PATTERN.test(model);
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
