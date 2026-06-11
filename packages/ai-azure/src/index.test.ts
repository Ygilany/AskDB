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
});
