/**
 * Contract tests against the REAL `@ai-sdk/google` provider (no module mocks).
 * `fetch` is stubbed so we can assert the exact HTTP request body the SDK
 * sends — this catches provider-option keys/shapes the SDK silently ignores,
 * which mocked-SDK unit tests can't.
 */
import { embed, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { googleProvider } from "./index";

type CapturedRequest = { url: string; body: Record<string, unknown> };

/**
 * Captures every outgoing request. Returns `respond()`'s response when given;
 * otherwise fails the request so no response parsing is needed.
 */
function captureFetch(respond?: () => Response): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      if (respond) return respond();
      throw new Error("contract-test: request captured");
    }),
  );
  return requests;
}

function embeddingResponse(): Response {
  return new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function captureGenerate(
  model: string,
  reasoningEffort?: "minimal" | "low" | "medium" | "high",
): Promise<CapturedRequest> {
  const requests = captureFetch();
  const config = { provider: "google", apiKey: "test-key", model };
  const providerOptions = googleProvider.resolveProviderOptions?.(config, { reasoningEffort });
  await expect(
    generateText({
      model: googleProvider.createLanguageModel(config),
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

function thinkingConfigOf(request: CapturedRequest): unknown {
  return (request.body.generationConfig as Record<string, unknown> | undefined)?.thinkingConfig;
}

describe("googleProvider — real @ai-sdk/google contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("targets the model's generateContent endpoint and sends no thinkingConfig by default", async () => {
    const request = await captureGenerate("gemini-2.0-flash");
    expect(request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
    expect(thinkingConfigOf(request)).toBeUndefined();
  });

  it("sends thinkingConfig.thinkingBudget for Gemini 2.5 models", async () => {
    const request = await captureGenerate("gemini-2.5-flash", "low");
    expect(request.url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(thinkingConfigOf(request)).toEqual({ thinkingBudget: 1024 });
  });

  it("sends thinkingConfig.thinkingLevel for Gemini 3 models", async () => {
    const request = await captureGenerate("gemini-3-pro-preview", "high");
    expect(request.url).toContain("/models/gemini-3-pro-preview:generateContent");
    expect(thinkingConfigOf(request)).toEqual({ thinkingLevel: "high" });
  });

  it("maps embedding dimensions to outputDimensionality in the request body", async () => {
    const requests = captureFetch(embeddingResponse);
    const model = googleProvider.createEmbeddingModel(
      { provider: "google", apiKey: "test-key", model: "gemini-embedding-001" },
      { dimensions: 768, user: "user-1" },
    );
    const result = await embed({ model, value: "customers", maxRetries: 0 });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    );
    expect(requests[0]!.body).toMatchObject({
      model: "models/gemini-embedding-001",
      outputDimensionality: 768,
    });
    // Gemini has no per-end-user field; `user` must not leak into the body.
    expect(requests[0]!.body).not.toHaveProperty("user");
  });

  it("omits outputDimensionality when no dimensions are requested", async () => {
    const requests = captureFetch(embeddingResponse);
    const model = googleProvider.createEmbeddingModel({
      provider: "google",
      apiKey: "test-key",
      model: "gemini-embedding-001",
    });
    await embed({ model, value: "customers", maxRetries: 0 });
    expect(requests[0]!.body).not.toHaveProperty("outputDimensionality");
  });
});
