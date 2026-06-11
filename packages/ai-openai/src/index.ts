import { createOpenAI } from "@ai-sdk/openai";
import type { AiProviderAdapter, CreateEmbeddingModelOptions } from "@askdb/ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
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
