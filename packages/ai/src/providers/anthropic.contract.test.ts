/**
 * Contract tests against the REAL `@ai-sdk/anthropic` provider (no module
 * mocks). `fetch` is stubbed so we can assert the exact HTTP request body the
 * SDK sends — this catches provider-option keys/shapes the SDK silently
 * ignores, which mocked-SDK unit tests can't.
 */
import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "./anthropic.js";

type CapturedRequest = { url: string; body: Record<string, unknown> };

/** Captures every outgoing request, then fails it so no response parsing is needed. */
function captureFetch(): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      throw new Error("contract-test: request captured");
    }),
  );
  return requests;
}

async function captureGenerate(
  model: string,
  reasoningEffort?: "minimal" | "low" | "medium" | "high",
  baseURL?: string,
): Promise<CapturedRequest> {
  const requests = captureFetch();
  const config = { provider: "anthropic", apiKey: "test-key", model, ...(baseURL ? { baseURL } : {}) };
  const providerOptions = anthropicProvider.resolveProviderOptions?.(config, { reasoningEffort });
  await expect(
    generateText({
      model: await anthropicProvider.createLanguageModel(config),
      prompt: "How many customers?",
      temperature: 0,
      maxRetries: 0,
      ...(providerOptions
        ? { providerOptions: providerOptions as Parameters<typeof generateText>[0]["providerOptions"] }
        : {}),
    }),
  ).rejects.toThrow();
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

describe("anthropicProvider — real @ai-sdk/anthropic contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the model id and no thinking block when reasoningEffort is unset", async () => {
    const request = await captureGenerate("claude-sonnet-4-6");
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.body.model).toBe("claude-sonnet-4-6");
    expect(request.body).not.toHaveProperty("thinking");
    expect(request.body.temperature).toBe(0);
  });

  it("sends requests to the configured baseURL", async () => {
    const request = await captureGenerate("claude-sonnet-4-6", undefined, "https://proxy.example/a");
    expect(request.url).toBe("https://proxy.example/a/messages");
  });

  it("sends adaptive thinking + output_config.effort for adaptive-thinking models", async () => {
    const request = await captureGenerate("claude-opus-4-8", "medium");
    expect(request.body.model).toBe("claude-opus-4-8");
    expect(request.body.thinking).toEqual({ type: "adaptive" });
    expect(request.body.output_config).toMatchObject({ effort: "medium" });
    expect(request.body).not.toHaveProperty("temperature");
  });

  it("sends manual budget thinking for pre-adaptive extended-thinking models", async () => {
    const request = await captureGenerate("claude-haiku-4-5", "low");
    expect(request.body.model).toBe("claude-haiku-4-5");
    expect(request.body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(request.body).not.toHaveProperty("temperature");
  });

  it("sends no thinking block for models without extended thinking", async () => {
    const request = await captureGenerate("claude-3-5-haiku-20241022", "high");
    expect(request.body).not.toHaveProperty("thinking");
  });

  it("throws a clear error for embeddings (Anthropic has no embeddings API)", () => {
    expect(() =>
      anthropicProvider.createEmbeddingModel(
        { provider: "anthropic", apiKey: "test-key", model: "any" },
        { dimensions: 256 },
      ),
    ).toThrow(/Anthropic does not provide an embeddings API.*rag\.embedder/);
  });
});
