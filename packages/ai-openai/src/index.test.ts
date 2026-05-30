import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const openai = vi.fn((model: string) => ({ kind: "language", model }));
  Object.assign(openai, {
    embedding: vi.fn((model: string, options: unknown) => ({
      kind: "embedding",
      model,
      options,
    })),
  });

  return {
    createOpenAI: vi.fn(() => openai),
    openai,
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

import { openaiProvider } from "./index";

describe("openaiProvider", () => {
  beforeEach(() => {
    mocks.createOpenAI.mockClear();
    mocks.openai.mockClear();
    mocks.openai.embedding.mockClear();
  });

  it("creates language and embedding models from AskDB config", () => {
    expect(openaiProvider.provider).toBe("openai");

    const languageModel = openaiProvider.createLanguageModel({
      provider: "openai",
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "gpt-4o-mini",
    });
    const embeddingModel = openaiProvider.createEmbeddingModel(
      {
        provider: "openai",
        apiKey: "test-key",
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
    expect(mocks.createOpenAI).toHaveBeenNthCalledWith(1, {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
    });
    expect(mocks.createOpenAI).toHaveBeenNthCalledWith(2, {
      apiKey: "test-key",
    });
  });
});
