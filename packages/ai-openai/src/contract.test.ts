/**
 * Contract tests against the REAL `@ai-sdk/openai` provider (no module mocks).
 * `fetch` is stubbed so we can assert the exact HTTP request body the SDK
 * sends — this catches provider-option keys/shapes the SDK silently ignores,
 * which mocked-SDK unit tests can't.
 */
import { embed, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiProvider } from "./index";

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
  return new Response(
    JSON.stringify({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function captureGenerate(
  model: string,
  reasoningEffort?: "minimal" | "low" | "medium" | "high",
): Promise<CapturedRequest> {
  const requests = captureFetch();
  const config = { provider: "openai", apiKey: "test-key", model };
  const providerOptions = openaiProvider.resolveProviderOptions?.(config, { reasoningEffort });
  await expect(
    generateText({
      model: openaiProvider.createLanguageModel(config),
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

describe("openaiProvider — real @ai-sdk/openai contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the model id and no reasoning block for non-reasoning models", async () => {
    const request = await captureGenerate("gpt-4o-mini", "high");
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.body.model).toBe("gpt-4o-mini");
    expect(request.body).not.toHaveProperty("reasoning");
  });

  it("sends reasoning.effort for reasoning models when reasoningEffort is set", async () => {
    const request = await captureGenerate("gpt-5-mini", "low");
    expect(request.body.model).toBe("gpt-5-mini");
    expect(request.body.reasoning).toMatchObject({ effort: "low" });
  });

  it("sends reasoning.effort for o-series models", async () => {
    const request = await captureGenerate("o4-mini", "high");
    expect(request.body.reasoning).toMatchObject({ effort: "high" });
  });

  it("does not send reasoning for gpt-5 -chat variants", async () => {
    const request = await captureGenerate("gpt-5-chat-latest", "high");
    expect(request.body.model).toBe("gpt-5-chat-latest");
    expect(request.body).not.toHaveProperty("reasoning");
  });

  it("forwards embedding dimensions and user to the request body", async () => {
    const requests = captureFetch(embeddingResponse);
    const model = openaiProvider.createEmbeddingModel(
      { provider: "openai", apiKey: "test-key", model: "text-embedding-3-small" },
      { dimensions: 256, user: "user-1" },
    );
    const result = await embed({ model, value: "customers", maxRetries: 0 });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/embeddings");
    expect(requests[0]!.body).toMatchObject({
      model: "text-embedding-3-small",
      input: ["customers"],
      dimensions: 256,
      user: "user-1",
    });
  });
});
