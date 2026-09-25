import { describe, expect, it } from "vitest";
import { anthropicProvider } from "./anthropic.js";

describe("anthropicProvider", () => {
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
