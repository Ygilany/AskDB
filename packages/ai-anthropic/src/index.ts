import { createAnthropic } from "@ai-sdk/anthropic";
import {
  resolveBaseConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
  type ReasoningEffort,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["ANTHROPIC_API_KEY"],
  modelVars: ["ANTHROPIC_MODEL"],
  baseURLVars: ["ANTHROPIC_BASE_URL"],
  defaultModel: "claude-sonnet-4-6",
};

/** Claude model families that support extended thinking. */
const THINKING_MODEL_PATTERN = /claude-(opus|sonnet)-4|claude-3-7-sonnet/i;

function isThinkingModel(model: string): boolean {
  return THINKING_MODEL_PATTERN.test(model);
}

/** Extended-thinking `budgetTokens` per portable effort level (Anthropic requires >= 1024). */
const THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
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
      "Anthropic does not provide an embeddings API. Configure a separate embedding provider " +
        "via rag.embedder in askdb.config.* (e.g. OpenAI) while using Anthropic for chat.",
    );
  },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort || !isThinkingModel(config.model)) return undefined;
    return {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: THINKING_BUDGETS[reasoningEffort] },
      },
    };
  },
};
