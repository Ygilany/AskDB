import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const openai = vi.fn((model: string) => ({ kind: "language", model }));
  Object.assign(openai, {
    embedding: vi.fn((model: string) => ({
      kind: "embedding",
      model,
    })),
  });

  return {
    createOpenAI: vi.fn(() => openai),
    defaultEmbeddingSettingsMiddleware: vi.fn((settings: unknown) => ({
      kind: "middleware",
      settings,
    })),
    openai,
    wrapEmbeddingModel: vi.fn((options: unknown) => ({
      kind: "wrapped",
      options,
    })),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));
vi.mock("ai", () => ({
  defaultEmbeddingSettingsMiddleware: mocks.defaultEmbeddingSettingsMiddleware,
  wrapEmbeddingModel: mocks.wrapEmbeddingModel,
}));

import { openaiProvider } from "./index";

describe("openaiProvider", () => {
  beforeEach(() => {
    mocks.createOpenAI.mockClear();
    mocks.defaultEmbeddingSettingsMiddleware.mockClear();
    mocks.openai.mockClear();
    mocks.openai.embedding.mockClear();
    mocks.wrapEmbeddingModel.mockClear();
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
      kind: "wrapped",
      options: {
        model: { kind: "embedding", model: "text-embedding-3-small" },
        middleware: {
          kind: "middleware",
          settings: {
            settings: {
              providerOptions: {
                openai: {
                  dimensions: 512,
                  user: "user-1",
                },
              },
            },
          },
        },
      },
    });
    expect(mocks.createOpenAI).toHaveBeenNthCalledWith(1, {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
    });
    expect(mocks.createOpenAI).toHaveBeenNthCalledWith(2, {
      apiKey: "test-key",
    });
    expect(mocks.openai.embedding).toHaveBeenCalledWith("text-embedding-3-small");
  });

  describe("resolveProviderOptions", () => {
    const baseConfig = { provider: "openai", apiKey: "k" } as const;

    it("maps reasoningEffort to providerOptions.openai.reasoningEffort for o-series models", () => {
      expect(
        openaiProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "o3-mini" },
          { reasoningEffort: "low" },
        ),
      ).toEqual({ openai: { reasoningEffort: "low" } });
    });

    it("maps reasoningEffort for gpt-5.x models", () => {
      expect(
        openaiProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "gpt-5-mini" },
          { reasoningEffort: "high" },
        ),
      ).toEqual({ openai: { reasoningEffort: "high" } });
    });

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        openaiProvider.resolveProviderOptions?.({ ...baseConfig, model: "o3-mini" }, {}),
      ).toBeUndefined();
    });

    it("returns undefined for non-reasoning models (e.g. gpt-4o-mini)", () => {
      expect(
        openaiProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "gpt-4o-mini" },
          { reasoningEffort: "high" },
        ),
      ).toBeUndefined();
    });

    it.each([
      ["o1", true],
      ["o3", true],
      ["o3-mini", true],
      ["o4-mini-2025-04-16", true],
      ["gpt-5", true],
      ["gpt-5-mini", true],
      ["gpt-5-nano", true],
      ["gpt-5.1", true],
      ["gpt-5.2-pro", true],
      ["gpt-5-codex", true],
      ["gpt-6", true],
      // -chat variants are non-reasoning chat models
      ["gpt-5-chat", false],
      ["gpt-5-chat-latest", false],
      ["gpt-5.1-chat-latest", false],
      // older / non-reasoning families
      ["gpt-4o", false],
      ["gpt-4o-mini", false],
      ["gpt-4.1", false],
      ["gpt-4.1-mini", false],
      ["gpt-3.5-turbo", false],
      ["omni-moderation-latest", false],
      ["my-gpt-5-proxy", false],
    ] as const)("%s → reasoning model: %s", (model, isReasoning) => {
      const result = openaiProvider.resolveProviderOptions?.(
        { ...baseConfig, model },
        { reasoningEffort: "medium" },
      );
      expect(result).toEqual(isReasoning ? { openai: { reasoningEffort: "medium" } } : undefined);
    });
  });
});
