import { createOpenAI } from "@ai-sdk/openai";
import {
  resolveBaseConfig,
  type AiProviderAdapter,
  type CreateEmbeddingModelOptions,
  type ProviderEnvSpec,
} from "@askdb/ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["OPENAI_API_KEY"],
  apiKeySecondaryVars: ["OPENAI_API_KEY_SECONDARY"],
  modelVars: ["OPENAI_MODEL"],
  embeddingModelVars: ["OPENAI_EMBEDDING_MODEL"],
  baseURLVars: ["OPENAI_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
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
    const providerOptions = openAiProviderOptions(options);
    if (!providerOptions) return model;
    return wrapEmbeddingModel({
      model,
      middleware: defaultEmbeddingSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  },
};

function openAiProviderOptions(
  options: CreateEmbeddingModelOptions,
): { openai: { dimensions?: number; user?: string } } | undefined {
  const openai: { dimensions?: number; user?: string } = {};
  if (options.dimensions !== undefined) openai.dimensions = options.dimensions;
  if (options.user !== undefined) openai.user = options.user;
  return Object.keys(openai).length > 0 ? { openai } : undefined;
}
