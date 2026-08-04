import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const azure = vi.fn((model: string) => ({ kind: "language", model }));
  Object.assign(azure, {
    embedding: vi.fn((model: string) => ({
      kind: "embedding",
      model,
    })),
  });

  return {
    createAzure: vi.fn(() => azure),
    defaultEmbeddingSettingsMiddleware: vi.fn((settings: unknown) => ({
      kind: "middleware",
      settings,
    })),
    azure,
    wrapEmbeddingModel: vi.fn((options: unknown) => ({
      kind: "wrapped",
      options,
    })),
  };
});

vi.mock("@ai-sdk/azure", () => ({
  createAzure: mocks.createAzure,
}));
vi.mock("ai", () => ({
  defaultEmbeddingSettingsMiddleware: mocks.defaultEmbeddingSettingsMiddleware,
  wrapEmbeddingModel: mocks.wrapEmbeddingModel,
}));

import { azureProvider } from "./index";

describe("azureProvider", () => {
  beforeEach(() => {
    mocks.createAzure.mockClear();
    mocks.defaultEmbeddingSettingsMiddleware.mockClear();
    mocks.azure.mockClear();
    mocks.azure.embedding.mockClear();
    mocks.wrapEmbeddingModel.mockClear();
  });

  it("creates language and embedding models from AskDB config", () => {
    expect(azureProvider.provider).toBe("azure");

    const languageModel = azureProvider.createLanguageModel({
      provider: "azure",
      apiKey: "test-key",
      baseURL: "https://askdb-ai.openai.azure.com",
      model: "gpt-4o-mini",
      providerOptions: {
        resourceName: "askdb-ai",
        apiVersion: "2024-10-21",
      },
    });
    const embeddingModel = azureProvider.createEmbeddingModel(
      {
        provider: "azure",
        apiKey: "test-key",
        model: "text-embedding-3-small",
        providerOptions: {
          resourceName: "askdb-ai",
        },
      },
      { dimensions: 512, user: "user-1" },
    );

    expect(languageModel).toEqual({ kind: "language", model: "gpt-4o-mini" });
    expect(embeddingModel).toEqual({
      kind: "wrapped",
      options: {
        model: { kind: "embedding", model: "text-embedding-3-small" },
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                azure: {
                  dimensions: 512,
                  user: "user-1",
                },
              },
            },
          },
        },
      },
    });
    expect(mocks.createAzure).toHaveBeenNthCalledWith(1, {
      apiKey: "test-key",
      resourceName: "askdb-ai",
      baseURL: "https://askdb-ai.openai.azure.com",
      apiVersion: "2024-10-21",
    });
    expect(mocks.createAzure).toHaveBeenNthCalledWith(2, {
      apiKey: "test-key",
      resourceName: "askdb-ai",
    });
    expect(mocks.azure.embedding).toHaveBeenCalledWith("text-embedding-3-small");
  });

  it("resolves native Azure config into provider options", () => {
    const config = azureProvider.resolveConfig(
      {
        AZURE_OPENAI_API_KEY: "azure-native",
        OPENAI_API_KEY: "ignored",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        ASKDB_AI_AZURE_API_VERSION: "2024-10-21",
        AZURE_OPENAI_DEPLOYMENT: "chat-deployment",
      },
      { usage: "language" },
    );

    expect(config).toEqual({
      provider: "azure",
      apiKey: "azure-native",
      model: "chat-deployment",
      providerOptions: {
        resourceName: "my-foundry",
        apiVersion: "2024-10-21",
      },
    });
  });

  it("resolves Azure embedding deployments", () => {
    const config = azureProvider.resolveConfig(
      {
        AZURE_OPENAI_API_KEY: "k",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        AZURE_OPENAI_DEPLOYMENT: "chat-deployment",
        AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "embedding-deployment",
      },
      { usage: "embedding" },
    );

    expect(config).toEqual({
      provider: "azure",
      apiKey: "k",
      model: "embedding-deployment",
      providerOptions: {
        resourceName: "my-foundry",
      },
    });
  });

  it("returns undefined when only OPENAI_API_KEY is configured for Azure", () => {
    expect(
      azureProvider.resolveConfig(
        {
          OPENAI_API_KEY: "openai-only",
          ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        },
        { usage: "language" },
      ),
    ).toBeUndefined();
  });

  it("throws without resourceName or baseURL", () => {
    expect(() =>
      azureProvider.resolveConfig({ AZURE_OPENAI_API_KEY: "k" }, { usage: "language" }),
    ).toThrowError(/Azure provider requires/);
  });

  describe("resolveProviderOptions", () => {
    const baseConfig = { provider: "azure", apiKey: "k" } as const;

    it("maps reasoningEffort under the openai namespace (not azure) for o-series deployments", () => {
      // @ai-sdk/azure only reads providerOptions.openai — see the comment in
      // src/index.ts for why the "azure" namespace would be silently ignored.
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "o3-mini" },
          { reasoningEffort: "low" },
        ),
      ).toEqual({ openai: { reasoningEffort: "low" } });
    });

    it("maps reasoningEffort for gpt-5.x deployments", () => {
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "gpt-5-mini" },
          { reasoningEffort: "high" },
        ),
      ).toEqual({ openai: { reasoningEffort: "high" } });
    });

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        azureProvider.resolveProviderOptions?.({ ...baseConfig, model: "o3-mini" }, {}),
      ).toBeUndefined();
    });

    it("returns undefined for non-reasoning deployments (e.g. gpt-4o-mini)", () => {
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "gpt-4o-mini" },
          { reasoningEffort: "high" },
        ),
      ).toBeUndefined();
    });

    it("uses providerOptions.modelFamily to detect reasoning support when the deployment name doesn't match", () => {
      // Deployment named arbitrarily ("askdb-reporting"), but backed by a
      // reasoning-capable model declared via the modelFamily override.
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "askdb-reporting", providerOptions: { modelFamily: "gpt-5" } },
          { reasoningEffort: "low" },
        ),
      ).toEqual({ openai: { reasoningEffort: "low" } });
    });

    it("does not send reasoningEffort when modelFamily override names a non-reasoning model", () => {
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "o3-mini", providerOptions: { modelFamily: "gpt-4o-mini" } },
          { reasoningEffort: "low" },
        ),
      ).toBeUndefined();
    });
  });

  describe("resolveConfig — modelFamily", () => {
    it("resolves ASKDB_AI_AZURE_MODEL_FAMILY into providerOptions.modelFamily", () => {
      const config = azureProvider.resolveConfig(
        {
          AZURE_OPENAI_API_KEY: "k",
          ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
          AZURE_OPENAI_DEPLOYMENT: "askdb-reporting",
          ASKDB_AI_AZURE_MODEL_FAMILY: "gpt-5",
        },
        { usage: "language" },
      );
      expect(config?.providerOptions).toMatchObject({ modelFamily: "gpt-5" });
    });
  });
});
