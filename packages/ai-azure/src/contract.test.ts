/**
 * Contract tests against the REAL `@ai-sdk/azure` provider (no module mocks).
 * `fetch` is stubbed so we can assert the exact HTTP request body the SDK
 * sends — this catches provider-option keys/shapes the SDK silently ignores
 * (e.g. embedding `dimensions` under an "azure" key, which
 * `OpenAIEmbeddingModel` never reads), which mocked-SDK unit tests can't.
 */
import type { AiConfig } from "@askdb/ai";
import { embed, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { azureProvider } from "./index";

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
  config: AiConfig,
  reasoningEffort?: "minimal" | "low" | "medium" | "high",
): Promise<CapturedRequest> {
  const requests = captureFetch();
  const providerOptions = azureProvider.resolveProviderOptions?.(config, { reasoningEffort });
  await expect(
    generateText({
      model: azureProvider.createLanguageModel(config),
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

const baseConfig = {
  provider: "azure",
  apiKey: "test-key",
  providerOptions: { resourceName: "my-foundry" },
} as const;

describe("azureProvider — real @ai-sdk/azure contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("targets the resource's Responses endpoint with the deployment name as model", async () => {
    const request = await captureGenerate({ ...baseConfig, model: "gpt-4o-mini" }, "high");
    expect(request.url).toBe(
      "https://my-foundry.openai.azure.com/openai/v1/responses?api-version=v1",
    );
    expect(request.body.model).toBe("gpt-4o-mini");
    expect(request.body).not.toHaveProperty("reasoning");
  });

  it("sends reasoning.effort for reasoning-model deployments", async () => {
    const request = await captureGenerate({ ...baseConfig, model: "o4-mini" }, "low");
    expect(request.body.model).toBe("o4-mini");
    expect(request.body.reasoning).toMatchObject({ effort: "low" });
  });

  it("sends reasoning.effort for arbitrarily-named deployments declared via modelFamily", async () => {
    // Without forceReasoning the SDK infers capabilities from the deployment
    // name ("askdb-reporting") and silently drops reasoningEffort.
    const request = await captureGenerate(
      {
        ...baseConfig,
        model: "askdb-reporting",
        providerOptions: { ...baseConfig.providerOptions, modelFamily: "gpt-5" },
      },
      "medium",
    );
    expect(request.body.model).toBe("askdb-reporting");
    expect(request.body.reasoning).toMatchObject({ effort: "medium" });
  });

  it("forwards embedding dimensions and user to the request body", async () => {
    const requests = captureFetch(embeddingResponse);
    const model = azureProvider.createEmbeddingModel(
      { ...baseConfig, model: "text-embedding-3-small" },
      { dimensions: 256, user: "user-1" },
    );
    const result = await embed({ model, value: "customers", maxRetries: 0 });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      "https://my-foundry.openai.azure.com/openai/v1/embeddings?api-version=v1",
    );
    expect(requests[0]!.body).toMatchObject({
      model: "text-embedding-3-small",
      input: ["customers"],
      dimensions: 256,
      user: "user-1",
    });
  });
});
