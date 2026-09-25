import { describe, expect, it } from "vitest";
import { openaiProvider } from "./openai.js";

describe("openaiProvider", () => {
  describe("resolveProviderOptions", () => {
    const baseConfig = { provider: "openai", apiKey: "k" } as const;

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        openaiProvider.resolveProviderOptions?.({ ...baseConfig, model: "o3-mini" }, {}),
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
