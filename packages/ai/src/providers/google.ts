import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import type { ReasoningEffort } from "../reasoning.js";
import { importOptionalPeer } from "./optional-peer.js";
import type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";

const PEER_PACKAGE = "@ai-sdk/google";

const ENV_SPEC: BuiltinProviderEnvSpec = {
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

const CONFIG_HINT =
  "For Google Gemini, set ai.provider: \"google\" and ai.providerConfig.google.apiKey in askdb.config.*.";

async function createProvider(config: AiConfig) {
  const { createGoogle } = await importOptionalPeer("google", PEER_PACKAGE, () => import("@ai-sdk/google"));
  return createGoogle({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

export const googleProvider: AiProviderAdapter = {
  provider: "google",
  configHint: CONFIG_HINT,
  resolveConfig(env, options) {
    return resolveBaseConfig("google", env, ENV_SPEC, options);
  },
  async createLanguageModel(config) {
    const google = await createProvider(config);
    return google(config.model);
  },
  async createEmbeddingModel(config, options = {}) {
    const google = await createProvider(config);
    const model = google.embedding(config.model);
    // Gemini's embedding API calls the output size `outputDimensionality`
    // (read from `providerOptions.google`). It has no per-end-user field, so
    // `options.user` is intentionally not forwarded.
    if (options.dimensions === undefined) return model;
    return wrapEmbeddingModel({
      model,
      middleware: defaultEmbeddingSettingsMiddleware({
        settings: {
          providerOptions: { google: { outputDimensionality: options.dimensions } },
        },
      }),
    });
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

export const googleBuiltin: BuiltinAiProvider = {
  provider: "google",
  label: "Google (Gemini)",
  aliases: [],
  peerPackage: PEER_PACKAGE,
  env: ENV_SPEC,
  embeddings: true,
  configHint: CONFIG_HINT,
  adapter: googleProvider,
};
