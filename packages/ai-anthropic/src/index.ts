import { createAnthropic } from "@ai-sdk/anthropic";
import {
  resolveBaseConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["ANTHROPIC_API_KEY"],
  modelVars: ["ANTHROPIC_MODEL"],
  baseURLVars: ["ANTHROPIC_BASE_URL"],
  defaultModel: "claude-sonnet-4-6",
};

export const anthropicProvider: AiProviderAdapter = {
  provider: "anthropic",
  configHint:
    "For Anthropic Claude, set ai.provider: \"anthropic\" and ai.providerConfig.anthropic.apiKey in askdb.config.*.",
  resolveConfig(env, options) {
    return resolveBaseConfig("anthropic", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return anthropic(config.model);
  },
  createEmbeddingModel() {
    throw new Error(
      "Anthropic does not provide an embeddings API. Configure a different embedding provider " +
        "(e.g. ASKDB_RAG_EMBEDDER with OpenAI) while using Anthropic for chat.",
    );
  },
};
