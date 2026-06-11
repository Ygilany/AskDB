import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiSdkEmbedder } from "./ai-sdk.js";

const mocks = vi.hoisted(() => ({
  embedMany: vi.fn(async () => ({
    embeddings: [[0.1, 0.2]],
    usage: { tokens: 12 },
  })),
}));

vi.mock("ai", () => ({
  embedMany: mocks.embedMany,
}));

describe("createAiSdkEmbedder", () => {
  beforeEach(() => {
    mocks.embedMany.mockClear();
  });

  it("forwards provider options to the AI SDK embedding call", async () => {
    const onUsage = vi.fn();
    const embedder = createAiSdkEmbedder({
      model: { kind: "embedding" } as never,
      maxRetries: 0,
      providerOptions: {
        openai: {
          dimensions: 512,
          user: "user-1",
        },
      },
      onUsage,
    });

    await expect(embedder(["orders"])).resolves.toEqual([[0.1, 0.2]]);
    expect(mocks.embedMany).toHaveBeenCalledWith({
      model: { kind: "embedding" },
      values: ["orders"],
      maxRetries: 0,
      providerOptions: {
        openai: {
          dimensions: 512,
          user: "user-1",
        },
      },
    });
    expect(onUsage).toHaveBeenCalledWith({ tokens: 12, promptTokens: undefined, totalTokens: undefined });
  });
});
