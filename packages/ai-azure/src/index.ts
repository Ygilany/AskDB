import { createAzure } from "@ai-sdk/azure";
import type { AiProviderAdapter, CreateEmbeddingModelOptions } from "@askdb/ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";

export const azureProvider: AiProviderAdapter = {
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
    const model = azure.embedding(config.model);
    const providerOptions = azureProviderOptions(options);
    if (!providerOptions) return model;
    return wrapEmbeddingModel({
      model,
      middleware: defaultEmbeddingSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  },
};

function azureProviderOptions(
  options: CreateEmbeddingModelOptions,
): { azure: { dimensions?: number; user?: string } } | undefined {
  const azure: { dimensions?: number; user?: string } = {};
  if (options.dimensions !== undefined) azure.dimensions = options.dimensions;
  if (options.user !== undefined) azure.user = options.user;
  return Object.keys(azure).length > 0 ? { azure } : undefined;
}
