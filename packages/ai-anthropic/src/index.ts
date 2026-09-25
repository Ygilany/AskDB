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

/**
 * Claude models that use *adaptive* thinking (`thinking: { type: "adaptive" }`
 * plus an `effort` level): Sonnet 4.6, Opus 4.6+, and the 5.x+ families
 * (Opus 5, Sonnet 5, Fable 5, …). Newer models reject manual `budget_tokens`
 * thinking, so they must not receive the budget form. Mirrors
 * `supportsAdaptiveThinking` in `@ai-sdk/anthropic`'s model capability table.
 */
const ADAPTIVE_THINKING_MODEL_PATTERN =
  /claude-(?:opus-4-[6-9]|sonnet-4-[6-9]|[a-z]+-(?:[5-9]|[1-9]\d))(?=$|[-.@:])/i;

/**
 * Claude models that support manual extended thinking
 * (`thinking: { type: "enabled", budgetTokens }`): Claude 3.7 Sonnet,
 * Sonnet 4 / Opus 4 / Opus 4.1, and the 4.5 family (Sonnet, Opus, Haiku).
 * Older models (Claude 3 / 3.5, Haiku 3.x) don't support thinking at all.
 */
const BUDGET_THINKING_MODEL_PATTERN =
  /claude-3-7-sonnet|claude-(?:opus|sonnet)-4(?:-[0-5])?(?=$|[-.@:])|claude-haiku-4-5(?=$|[-.@:])/i;

function resolveThinkingMode(model: string): "adaptive" | "budget" | undefined {
  if (ADAPTIVE_THINKING_MODEL_PATTERN.test(model)) return "adaptive";
  if (BUDGET_THINKING_MODEL_PATTERN.test(model)) return "budget";
  return undefined;
}

/** Extended-thinking `budgetTokens` per portable effort level (Anthropic requires >= 1024). */
const THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

/**
 * Adaptive-thinking `effort` per portable effort level. Anthropic has no
 * "minimal" level, so it maps to "low" — the same mapping `@ai-sdk/anthropic`
 * uses for the AI SDK's portable `reasoning` call option.
 */
const ADAPTIVE_EFFORTS: Record<ReasoningEffort, "low" | "medium" | "high"> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
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
    if (!reasoningEffort) return undefined;
    const mode = resolveThinkingMode(config.model);
    if (mode === "adaptive") {
      return {
        anthropic: {
          thinking: { type: "adaptive" },
          effort: ADAPTIVE_EFFORTS[reasoningEffort],
        },
      };
    }
    if (mode === "budget") {
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: THINKING_BUDGETS[reasoningEffort] },
        },
      };
    }
    return undefined;
  },
};
