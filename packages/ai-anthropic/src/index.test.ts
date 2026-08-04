import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const anthropic = vi.fn((model: string) => ({ kind: "language", model }));

  return {
    createAnthropic: vi.fn(() => anthropic),
    anthropic,
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

import { anthropicProvider } from "./index";

describe("anthropicProvider", () => {
  beforeEach(() => {
    mocks.createAnthropic.mockClear();
    mocks.anthropic.mockClear();
  });

  it("has the correct provider id", () => {
    expect(anthropicProvider.provider).toBe("anthropic");
  });

  it("creates a language model from AskDB config", () => {
    const languageModel = anthropicProvider.createLanguageModel({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    expect(languageModel).toEqual({ kind: "language", model: "claude-sonnet-4-6" });
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.anthropic).toHaveBeenCalledWith("claude-sonnet-4-6");
  });

  it("forwards baseURL when provided", () => {
    anthropicProvider.createLanguageModel({
      provider: "anthropic",
      apiKey: "test-key",
      baseURL: "https://custom.anthropic.endpoint/v1",
      model: "claude-haiku-4-5-20251001",
    });

    expect(mocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://custom.anthropic.endpoint/v1",
    });
  });

  it("throws when createEmbeddingModel is called", () => {
    expect(() =>
      anthropicProvider.createEmbeddingModel({
        provider: "anthropic",
        apiKey: "test-key",
        model: "some-model",
      }),
    ).toThrow(/embeddings/);
  });

  it("resolves ANTHROPIC_API_KEY and defaults the model to claude-sonnet-4-6", () => {
    expect(
      anthropicProvider.resolveConfig(
        { ANTHROPIC_API_KEY: "anthropic-key" },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "anthropic",
      apiKey: "anthropic-key",
      model: "claude-sonnet-4-6",
    });
  });

  it("uses ASKDB_AI_API_KEY when set (universal key takes precedence)", () => {
    expect(
      anthropicProvider.resolveConfig(
        {
          ASKDB_AI_API_KEY: "universal-key",
          ANTHROPIC_API_KEY: "anthropic-native",
        },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "anthropic",
      apiKey: "universal-key",
      model: "claude-sonnet-4-6",
    });
  });

  it("uses ANTHROPIC_MODEL to override the model", () => {
    expect(
      anthropicProvider.resolveConfig(
        {
          ANTHROPIC_API_KEY: "key",
          ANTHROPIC_MODEL: "claude-opus-4-8",
        },
        { usage: "language" },
      ),
    ).toEqual({
      provider: "anthropic",
      apiKey: "key",
      model: "claude-opus-4-8",
    });
  });

  it("returns undefined when no API key is configured", () => {
    expect(
      anthropicProvider.resolveConfig({}, { usage: "language" }),
    ).toBeUndefined();
  });

  it("has a configHint that references the askdb.config path", () => {
    expect(anthropicProvider.configHint).toMatch(/providerConfig\.anthropic\.apiKey/);
  });

  describe("resolveProviderOptions", () => {
    const baseConfig = { provider: "anthropic", apiKey: "k" } as const;

    it("maps reasoningEffort to extended thinking for Claude Sonnet 4 models", () => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-sonnet-4-6" },
          { reasoningEffort: "medium" },
        ),
      ).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 8192 } } });
    });

    it("maps reasoningEffort to extended thinking for Claude Opus 4 models", () => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-opus-4-8" },
          { reasoningEffort: "high" },
        ),
      ).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 16384 } } });
    });

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-sonnet-4-6" },
          {},
        ),
      ).toBeUndefined();
    });

    it("returns undefined for models without extended thinking (e.g. Claude Haiku 4.5)", () => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-haiku-4-5-20251001" },
          { reasoningEffort: "high" },
        ),
      ).toBeUndefined();
    });
  });
});
