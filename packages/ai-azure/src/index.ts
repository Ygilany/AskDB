import { createAzure } from "@ai-sdk/azure";
import {
  resolveBaseConfig,
  withEmbeddingProviderOptions,
  type AiConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  apiKeySecondaryVars: ["AZURE_OPENAI_API_KEY_SECONDARY", "AZURE_API_KEY_SECONDARY"],
  modelVars: ["AZURE_OPENAI_DEPLOYMENT", "AZURE_DEPLOYMENT_NAME"],
  embeddingModelVars: [
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
    "AZURE_EMBEDDING_DEPLOYMENT_NAME",
  ],
  baseURLVars: ["AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "AZURE_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

export const azureProvider: AiProviderAdapter = {
  provider: "azure",
  aliases: ["azure-openai", "foundry"],
  resolveConfig(env, options) {
    const config = resolveBaseConfig("azure", env, ENV_SPEC, options);
    if (!config) return undefined;

    const resourceName =
      env.ASKDB_AI_AZURE_RESOURCE_NAME || env.AZURE_RESOURCE_NAME || undefined;
    const apiVersion =
      env.ASKDB_AI_AZURE_API_VERSION ||
      env.AZURE_OPENAI_API_VERSION ||
      env.AZURE_API_VERSION ||
      undefined;

    if (!config.baseURL && !resourceName) {
      throw new Error(
        "Azure provider requires ASKDB_AI_AZURE_RESOURCE_NAME (e.g. 'my-foundry') " +
          "or ASKDB_AI_BASE_URL pointing at the full endpoint.",
      );
    }

    const providerOptions = {
      ...(resourceName ? { resourceName } : {}),
      ...(apiVersion ? { apiVersion } : {}),
    };

    return {
      ...config,
      ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    };
  },
  createLanguageModel(config) {
    const { resourceName, apiVersion } = azureConnectionOptions(config);
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(resourceName ? { resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(apiVersion ? { apiVersion } : {}),
    });
    return azure(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    const { resourceName, apiVersion } = azureConnectionOptions(config);
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(resourceName ? { resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(apiVersion ? { apiVersion } : {}),
    });
    const model = azure.embedding(config.model);
    return withEmbeddingProviderOptions(model, "azure", options);
  },
};

function azureConnectionOptions(
  config: AiConfig,
): { resourceName?: string; apiVersion?: string } {
  return {
    resourceName: readStringOption(config.providerOptions, "resourceName"),
    apiVersion: readStringOption(config.providerOptions, "apiVersion"),
  };
}

function readStringOption(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

