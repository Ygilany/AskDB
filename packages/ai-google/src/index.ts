import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  resolveBaseConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
  type ReasoningEffort,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"],
  modelVars: ["GOOGLE_AI_MODEL"],
  embeddingModelVars: ["GOOGLE_AI_EMBEDDING_MODEL"],
  baseURLVars: ["GOOGLE_AI_BASE_URL"],
  defaultModel: "gemini-2.0-flash",
};

const GEMINI_3_PATTERN = /^gemini-3/i;
const GEMINI_25_PATTERN = /^gemini-2\.5/i;
const GEMINI_25_PRO_PATTERN = /^gemini-2\.5-pro/i;

/**
 * Gemini 2.5 `thinkingBudget` (in tokens) per portable effort level.
 * Gemini 2.5 Pro cannot fully disable thinking (minimum ~128 tokens) —
 * only Flash / Flash-Lite support `thinkingBudget: 0` — so `minimal` is
 * adjusted for Pro models in {@link resolveGemini25ThinkingBudget}.
 */
const GEMINI_25_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1024,
  medium: 8192,
  high: 24576,
};

function resolveGemini25ThinkingBudget(model: string, effort: ReasoningEffort): number {
  const budget = GEMINI_25_THINKING_BUDGETS[effort];
  if (budget === 0 && GEMINI_25_PRO_PATTERN.test(model)) return 128;
  return budget;
}

export const googleProvider: AiProviderAdapter = {
  provider: "google",
  configHint:
    "For Google Gemini, set ai.provider: \"google\" and ai.providerConfig.google.apiKey in askdb.config.*.",
  resolveConfig(env, options) {
    return resolveBaseConfig("google", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return google(config.model);
  },
  createEmbeddingModel(config) {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return google.textEmbeddingModel(config.model);
  },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort) return undefined;
    if (GEMINI_3_PATTERN.test(config.model)) {
      return { google: { thinkingConfig: { thinkingLevel: reasoningEffort } } };
    }
    if (GEMINI_25_PATTERN.test(config.model)) {
      return {
        google: {
          thinkingConfig: {
            thinkingBudget: resolveGemini25ThinkingBudget(config.model, reasoningEffort),
          },
        },
      };
    }
    return undefined;
  },
};
