import { describe, expect, it, vi } from "vitest";
import {
  createAiRegistry,
  resolveBaseConfig,
  type AiConfig,
  type AiEmbeddingSection,
  type AiLanguageSection,
  type AiProviderAdapter,
} from "./index.js";

/*
 * A host with an askdb.config file passes its typed `ai.language` / `ai.embedding` section; a host
 * without one passes an env map. Each built-in adapter maps both to the same `AiConfig`.
 */

const registry = createAiRegistry();

describe("resolveAiConfigFromSection", () => {
  it.each<[string, AiLanguageSection, AiConfig | undefined]>([
    [
      "openai: key, base URL and model",
      { provider: "openai", connection: { apiKey: "k", baseUrl: "https://proxy.example/v1" }, model: "gpt-5" },
      { provider: "openai", apiKey: "k", model: "gpt-5", baseURL: "https://proxy.example/v1" },
    ],
    [
      "openai: the secondary key when there's no primary, and the provider's default model",
      { provider: "openai", connection: { apiKeySecondary: "k2" } },
      { provider: "openai", apiKey: "k2", model: "gpt-4o-mini" },
    ],
    [
      "the primary key over the secondary",
      { provider: "openai", connection: { apiKey: "k", apiKeySecondary: "k2" }, model: "gpt-5" },
      { provider: "openai", apiKey: "k", model: "gpt-5" },
    ],
    [
      "anthropic",
      { provider: "anthropic", connection: { apiKey: "k", baseUrl: "https://ant.example" }, model: "claude-opus-4-8" },
      { provider: "anthropic", apiKey: "k", model: "claude-opus-4-8", baseURL: "https://ant.example" },
    ],
    [
      "google",
      { provider: "google", connection: { apiKey: "k", baseUrl: "https://g.example" }, model: "gemini-2.5-pro" },
      { provider: "google", apiKey: "k", model: "gemini-2.5-pro", baseURL: "https://g.example" },
    ],
    [
      "gateway",
      { provider: "gateway", connection: { apiKey: "k", baseUrl: "https://gw.example/v3/ai" }, model: "anthropic/claude-sonnet-4-6" },
      { provider: "gateway", apiKey: "k", model: "anthropic/claude-sonnet-4-6", baseURL: "https://gw.example/v3/ai" },
    ],
    [
      "azure: resource name, API version and model family",
      {
        provider: "azure",
        connection: { apiKey: "k", apiKeySecondary: "k2", resourceName: "eastus", apiVersion: "2025-04-01-preview" },
        model: "askdb-reporting",
        modelFamily: "gpt-5",
      },
      {
        provider: "azure",
        apiKey: "k",
        model: "askdb-reporting",
        providerOptions: { resourceName: "eastus", apiVersion: "2025-04-01-preview", modelFamily: "gpt-5" },
      },
    ],
    [
      "foundry: the azure adapter, by its canonical name, with a base URL and no resource",
      { provider: "foundry", connection: { apiKey: "k", baseUrl: "https://my-foundry.openai.azure.com/openai" } },
      { provider: "azure", apiKey: "k", model: "gpt-4o-mini", baseURL: "https://my-foundry.openai.azure.com/openai" },
    ],
    [
      "values trimmed, and a blank one counted as unset",
      { provider: "openai", connection: { apiKey: "  ", apiKeySecondary: " k2 ", baseUrl: " " }, model: " gpt-5 " },
      { provider: "openai", apiKey: "k2", model: "gpt-5" },
    ],
    ["no key: AI disabled", { provider: "openai", connection: { baseUrl: "https://proxy.example/v1" }, model: "gpt-5" }, undefined],
  ])("%s", (_name, section, expected) => {
    expect(registry.resolveAiConfigFromSection(section)).toEqual(expected);
  });

  it("refuses an azure connection with neither a resource name nor a base URL", () => {
    expect(() => registry.resolveAiConfigFromSection({ provider: "azure", connection: { apiKey: "k" } })).toThrow(
      /Azure provider requires a resource name or endpoint URL/,
    );
  });

  it("names how to register a provider the registry doesn't have", () => {
    expect(() =>
      createAiRegistry(["openai"]).resolveAiConfigFromSection({ provider: "google", connection: { apiKey: "k" } }),
    ).toThrow(/AI provider "google" is not registered\. It is built into @askdb\/ai/);
  });

  // A third-party adapter predating sections resolves from the universal ASKDB_AI_* keys, as a
  // custom provider's connection always did through the config file.
  it("resolves a section for a custom adapter that only reads env", () => {
    const mistral: AiProviderAdapter = {
      provider: "mistral",
      resolveConfig: (env, options) => resolveBaseConfig("mistral", env, { apiKeyVars: ["MISTRAL_API_KEY"] }, options),
      createLanguageModel: vi.fn(),
      createEmbeddingModel: vi.fn(),
    };
    const section = { provider: "mistral", connection: { apiKey: "k", baseUrl: "https://api.mistral.ai/v1" }, model: "mistral-large-2" };
    expect(createAiRegistry([mistral]).resolveAiConfigFromSection(section)).toEqual({
      provider: "mistral",
      apiKey: "k",
      model: "mistral-large-2",
      baseURL: "https://api.mistral.ai/v1",
    });
  });
});

describe("resolveEmbeddingConfigFromSection", () => {
  it.each<[string, AiEmbeddingSection, AiConfig | undefined]>([
    [
      "openai",
      { provider: "openai", connection: { apiKey: "k", baseUrl: "https://proxy.example/v1" }, model: "text-embedding-3-large", dimensions: 1024 },
      { provider: "openai", apiKey: "k", model: "text-embedding-3-large", baseURL: "https://proxy.example/v1" },
    ],
    [
      "azure: its own deployment and resource, and no model family",
      { provider: "azure", connection: { apiKey: "k", resourceName: "westus", apiVersion: "v1" }, model: "embed-deployment" },
      { provider: "azure", apiKey: "k", model: "embed-deployment", providerOptions: { resourceName: "westus", apiVersion: "v1" } },
    ],
    [
      "google",
      { provider: "google", connection: { apiKey: "k" }, model: "gemini-embedding-001" },
      { provider: "google", apiKey: "k", model: "gemini-embedding-001" },
    ],
    [
      "gateway",
      { provider: "gateway", connection: { apiKey: "k" }, model: "openai/text-embedding-3-small" },
      { provider: "gateway", apiKey: "k", model: "openai/text-embedding-3-small" },
    ],
    ["no key", { provider: "openai", connection: {}, model: "text-embedding-3-small" }, undefined],
  ])("%s", (_name, section, expected) => {
    expect(registry.resolveEmbeddingConfigFromSection(section)).toEqual(expected);
  });

  // The embedding model is baked into an index, so no layer picks one (ADR 0016), a custom
  // adapter's included.
  it.each([
    ["openai", registry],
    ["azure", registry],
    ["gateway", registry],
    [
      "a custom adapter that only reads env",
      createAiRegistry([
        {
          provider: "mistral",
          resolveConfig: (env, options) =>
            resolveBaseConfig("mistral", env, { apiKeyVars: [] }, options),
          createLanguageModel: vi.fn(),
          createEmbeddingModel: vi.fn(),
        },
      ]),
    ],
  ] as const)("%s: requires a model instead of picking one", (name, ai) => {
    const provider = name.startsWith("a custom") ? "mistral" : name;
    const connection = { apiKey: "k", resourceName: "eastus" };
    expect(() => ai.resolveEmbeddingConfigFromSection({ provider, connection })).toThrow(
      /no embedding model configured\. Set ai\.embedding\.model/,
    );
    expect(ai.resolveEmbeddingConfigFromSection({ provider, connection: {} })).toBeUndefined();
  });
});

describe("create*ModelFromSection", () => {
  function recordingAdapter(): AiProviderAdapter & {
    createLanguageModel: ReturnType<typeof vi.fn>;
    createEmbeddingModel: ReturnType<typeof vi.fn>;
  } {
    return {
      provider: "mistral",
      resolveConfig: (env, options) => resolveBaseConfig("mistral", env, { apiKeyVars: [] }, options),
      createLanguageModel: vi.fn(() => ({ kind: "language" }) as never),
      createEmbeddingModel: vi.fn(() => ({ kind: "embedding" }) as never),
    };
  }

  it("builds the language model from the resolved config, or nothing without a key", async () => {
    const adapter = recordingAdapter();
    const ai = createAiRegistry([adapter]);
    await expect(ai.createLanguageModelFromSection({ provider: "mistral", connection: {}, model: "m" })).resolves.toBeUndefined();
    await expect(
      ai.createLanguageModelFromSection({ provider: "mistral", connection: { apiKey: "k" }, model: "m" }),
    ).resolves.toEqual({ kind: "language" });
    expect(adapter.createLanguageModel).toHaveBeenCalledExactlyOnceWith({ provider: "mistral", apiKey: "k", model: "m" });
  });

  it("asks the embedding model for the section's dimensions unless the call sets its own", async () => {
    const adapter = recordingAdapter();
    const ai = createAiRegistry([adapter]);
    const section = { provider: "mistral", connection: { apiKey: "k" }, model: "e", dimensions: 256 };
    await ai.createEmbeddingModelFromSection(section);
    await ai.createEmbeddingModelFromSection(section, { dimensions: 64, user: "u" });
    const config = { provider: "mistral", apiKey: "k", model: "e" };
    expect(adapter.createEmbeddingModel.mock.calls).toEqual([
      [config, { dimensions: 256 }],
      [config, { dimensions: 64, user: "u" }],
    ]);
  });
});
