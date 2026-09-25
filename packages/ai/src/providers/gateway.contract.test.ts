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

  it("does not forward embedding options for non-openai upstreams", async () => {
    const requests = captureFetch();
    const model = await gatewayProvider.createEmbeddingModel(
      { provider: "gateway", apiKey: "gw-key", model: "google/gemini-embedding-001" },
      { dimensions: 256 },
    );
    await expect(embed({ model, value: "customers", maxRetries: 0 })).rejects.toThrow();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).not.toHaveProperty("providerOptions");
  });
});
