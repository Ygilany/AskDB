import { createAzure } from "@ai-sdk/azure";
import type { AskDbAiProviderAdapter } from "@askdb/ai";

export const azureProvider: AskDbAiProviderAdapter = {
  provider: "azure",
  createLanguageModel(config) {
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
    });
    return azure(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
    });
    return azure.embedding(config.model, {
      dimensions: options.dimensions,
      user: options.user,
    });
  },
};
