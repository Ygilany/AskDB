import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { AiProviderAdapter } from "@askdb/ai";

export const googleProvider: AiProviderAdapter = {
  provider: "google",
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
};
