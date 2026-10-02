/**
 * Contract tests against the REAL gateway provider that ships with `ai`
 * (no module mocks). `fetch` is stubbed so we can assert what the SDK sends.
 */
import { embed, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayProvider } from "./gateway.js";

type CapturedRequest = { url: string; headers: Headers; body: Record<string, unknown> };

function captureFetch(): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      throw new Error("contract-test: request captured");
    }),
  );
  return requests;
}

describe("gatewayProvider — real ai gateway contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves AI_GATEWAY_API_KEY and defaults to an upstream-prefixed model id", () => {
    expect(
      gatewayProvider.resolveConfig({ AI_GATEWAY_API_KEY: "gw-key" }, { usage: "language" }),
    ).toEqual({ provider: "gateway", apiKey: "gw-key", model: "openai/gpt-4o-mini" });
    expect(
      gatewayProvider.resolveConfig({ AI_GATEWAY_API_KEY: "gw-key" }, { usage: "embedding" }),
    ).toEqual({ provider: "gateway", apiKey: "gw-key", model: "openai/text-embedding-3-small" });
    expect(gatewayProvider.resolveConfig({}, { usage: "language" })).toBeUndefined();
  });

  it("sends the configured key and model id to the gateway", async () => {
    const requests = captureFetch();
    const model = await gatewayProvider.createLanguageModel({
      provider: "gateway",
      apiKey: "gw-key",
      model: "anthropic/claude-sonnet-4-6",
    });
    await expect(
      generateText({ model, prompt: "How many customers?", temperature: 0, maxRetries: 0 }),
    ).rejects.toThrow();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toMatch(/^https:\/\/ai-gateway\.vercel\.sh\//);
    expect(request!.headers.get("authorization")).toBe("Bearer gw-key");
    expect(request!.headers.get("ai-language-model-id")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("forwards embedding dimensions/user under providerOptions.openai for openai/ models", async () => {
    const requests = captureFetch();
    const model = await gatewayProvider.createEmbeddingModel(
      { provider: "gateway", apiKey: "gw-key", model: "openai/text-embedding-3-small" },
      { dimensions: 256, user: "user-1" },
    );
    await expect(embed({ model, value: "customers", maxRetries: 0 })).rejects.toThrow();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.providerOptions).toEqual({
      openai: { dimensions: 256, user: "user-1" },
    });
  });

  it("forwards embedding dimensions as outputDimensionality under providerOptions.google for google/ models", async () => {
    const requests = captureFetch();
    const model = await gatewayProvider.createEmbeddingModel(
      { provider: "gateway", apiKey: "gw-key", model: "google/gemini-embedding-001" },
      { dimensions: 256, user: "user-1" },
    );
    await expect(embed({ model, value: "customers", maxRetries: 0 })).rejects.toThrow();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.providerOptions).toEqual({ google: { outputDimensionality: 256 } });
  });

  it("refuses embedding dimensions for an upstream it can't map, instead of dropping them", async () => {
    await expect(
      (async () =>
        gatewayProvider.createEmbeddingModel(
          { provider: "gateway", apiKey: "gw-key", model: "cohere/embed-v4.0" },
          { dimensions: 256 },
        ))(),
    ).rejects.toThrow(/can't send embedding dimensions to "cohere" models/);
  });

  it("rejects a model id with no upstream prefix", async () => {
    await expect(
      (async () =>
        gatewayProvider.createEmbeddingModel({ provider: "gateway", apiKey: "gw-key", model: "text-embedding-3-small" }))(),
    ).rejects.toThrow(/model ids are "<provider>\/<model>".*got "text-embedding-3-small"/);
    await expect(
      (async () => gatewayProvider.createLanguageModel({ provider: "gateway", apiKey: "gw-key", model: "gpt-4o-mini" }))(),
    ).rejects.toThrow(/got "gpt-4o-mini"/);
  });

  it.each([
    ["openai/gpt-5-mini", "low", { openai: { reasoningEffort: "low", forceReasoning: true } }],
    ["anthropic/claude-sonnet-4-6", "medium", { anthropic: { thinking: { type: "adaptive" }, effort: "medium" } }],
    ["google/gemini-2.5-flash", "low", { google: { thinkingConfig: { thinkingBudget: 1024 } } }],
  ] as const)("sends %s reasoning effort under the upstream's provider options", async (modelId, effort, expected) => {
    const requests = captureFetch();
    const config = { provider: "gateway", apiKey: "gw-key", model: modelId };
    const providerOptions = gatewayProvider.resolveProviderOptions?.(config, { reasoningEffort: effort });
    expect(providerOptions).toEqual(expected);
    const model = await gatewayProvider.createLanguageModel(config);
    await expect(
      generateText({
        model,
        prompt: "How many customers?",
        maxRetries: 0,
        providerOptions: providerOptions as Parameters<typeof generateText>[0]["providerOptions"],
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.providerOptions).toEqual(expected);
  });

  it("sends no reasoning options for an upstream it doesn't map", () => {
    expect(
      gatewayProvider.resolveProviderOptions?.(
        { provider: "gateway", apiKey: "gw-key", model: "mistral/mistral-large" },
        { reasoningEffort: "high" },
      ),
    ).toBeUndefined();
  });

  it("sends requests to the configured baseURL", async () => {
    const requests = captureFetch();
    const model = await gatewayProvider.createLanguageModel({
      provider: "gateway",
      apiKey: "gw-key",
      model: "openai/gpt-4o-mini",
      baseURL: "https://gateway-proxy.example/v3/ai",
    });
    await expect(generateText({ model, prompt: "How many customers?", maxRetries: 0 })).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/^https:\/\/gateway-proxy\.example\/v3\/ai\//);
  });
});
