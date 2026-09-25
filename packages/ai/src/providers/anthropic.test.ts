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

import { anthropicProvider } from "./anthropic.js";

describe("anthropicProvider", () => {
  beforeEach(() => {
    mocks.createAnthropic.mockClear();
    mocks.anthropic.mockClear();
  });

  it("has the correct provider id", () => {
    expect(anthropicProvider.provider).toBe("anthropic");
  });

  it("creates a language model from AskDB config", async () => {
    const languageModel = await anthropicProvider.createLanguageModel({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    expect(languageModel).toEqual({ kind: "language", model: "claude-sonnet-4-6" });
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.anthropic).toHaveBeenCalledWith("claude-sonnet-4-6");
  });

  it("forwards baseURL when provided", async () => {
    await anthropicProvider.createLanguageModel({
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

    // Mirrors @ai-sdk/anthropic's model capability table: adaptive-thinking
    // models get `thinking: { type: "adaptive" }` + `effort`; older
    // extended-thinking models get a manual `budgetTokens`; pre-3.7 models
    // get nothing.
    it.each([
      // adaptive thinking
      ["claude-sonnet-4-6", "adaptive"],
      ["claude-opus-4-6", "adaptive"],
      ["claude-opus-4-7", "adaptive"],
      ["claude-opus-4-8", "adaptive"],
      ["claude-opus-5", "adaptive"],
      ["claude-opus-5-5", "adaptive"],
      ["claude-sonnet-5", "adaptive"],
      ["claude-sonnet-5-20260101", "adaptive"],
      ["claude-fable-5", "adaptive"],
      ["anthropic.claude-opus-4-6-v1:0", "adaptive"],
      // manual budget thinking
      ["claude-3-7-sonnet-20250219", "budget"],
      ["claude-3-7-sonnet-latest", "budget"],
      ["claude-sonnet-4-20250514", "budget"],
      ["claude-sonnet-4-0", "budget"],
      ["claude-opus-4-20250514", "budget"],
      ["claude-opus-4-1", "budget"],
      ["claude-opus-4-1-20250805", "budget"],
      ["claude-sonnet-4-5", "budget"],
      ["claude-sonnet-4-5-20250929", "budget"],
      ["claude-opus-4-5", "budget"],
      ["claude-haiku-4-5", "budget"],
      ["claude-haiku-4-5-20251001", "budget"],
      ["claude-sonnet-4@20250514", "budget"],
      // no extended thinking
      ["claude-3-5-sonnet-latest", "none"],
      ["claude-3-5-haiku-20241022", "none"],
      ["claude-3-haiku-20240307", "none"],
      ["claude-3-opus-20240229", "none"],
      ["gpt-4o-mini", "none"],
    ] as const)("%s → %s thinking", (model, mode) => {
      const result = anthropicProvider.resolveProviderOptions?.(
        { ...baseConfig, model },
        { reasoningEffort: "medium" },
      );
      if (mode === "adaptive") {
        expect(result).toEqual({
          anthropic: { thinking: { type: "adaptive" }, effort: "medium" },
        });
      } else if (mode === "budget") {
        expect(result).toEqual({
          anthropic: { thinking: { type: "enabled", budgetTokens: 8192 } },
        });
      } else {
        expect(result).toBeUndefined();
      }
    });

    it.each([
      ["minimal", "low"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
    ] as const)("maps %s effort to adaptive effort %s", (reasoningEffort, effort) => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-opus-5" },
          { reasoningEffort },
        ),
      ).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort } });
    });

    it.each([
      ["minimal", 1024],
      ["low", 2048],
      ["medium", 8192],
      ["high", 16384],
    ] as const)("maps %s effort to budgetTokens %d", (reasoningEffort, budgetTokens) => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-sonnet-4-5" },
          { reasoningEffort },
        ),
      ).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens } } });
    });

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        anthropicProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "claude-sonnet-4-6" },
          {},
        ),
      ).toBeUndefined();
    });
  });
});
