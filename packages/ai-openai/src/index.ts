import { createOpenAI } from "@ai-sdk/openai";
import type { AskDbAiProviderAdapter } from "@askdb/ai";

export const openaiProvider: AskDbAiProviderAdapter = {
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
    return openai.embedding(config.model, {
      dimensions: options.dimensions,
      user: options.user,
    });
  },
};
