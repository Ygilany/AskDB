import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const azure = vi.fn((model: string) => ({ kind: "language", model }));
  Object.assign(azure, {
    embedding: vi.fn((model: string, options: unknown) => ({
      kind: "embedding",
      model,
      options,
    })),
  });

  return {
    createAzure: vi.fn(() => azure),
    azure,
  };
});

vi.mock("@ai-sdk/azure", () => ({
  createAzure: mocks.createAzure,
}));

import { azureProvider } from "./index";

describe("azureProvider", () => {
  beforeEach(() => {
    mocks.createAzure.mockClear();
    mocks.azure.mockClear();
    mocks.azure.embedding.mockClear();
  });

  it("creates language and embedding models from AskDB config", () => {
    expect(azureProvider.provider).toBe("azure");

    const languageModel = azureProvider.createLanguageModel({
      provider: "azure",
      apiKey: "test-key",
      resourceName: "askdb-ai",
      baseURL: "https://askdb-ai.openai.azure.com",
      apiVersion: "2024-10-21",
      model: "gpt-4o-mini",
    });
    const embeddingModel = azureProvider.createEmbeddingModel(
      {
        provider: "azure",
        apiKey: "test-key",
        resourceName: "askdb-ai",
        model: "text-embedding-3-small",
      },
      { dimensions: 512, user: "user-1" },
    );

    expect(languageModel).toEqual({ kind: "language", model: "gpt-4o-mini" });
    expect(embeddingModel).toEqual({
      kind: "embedding",
      model: "text-embedding-3-small",
      options: { dimensions: 512, user: "user-1" },
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
  });
});
