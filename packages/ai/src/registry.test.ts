import { describe, expect, it, vi } from "vitest";
import type { AiProviderAdapter } from "./provider.js";
import {
  BUILTIN_AI_PROVIDERS,
  BUILTIN_AI_PROVIDER_NAMES,
  anthropicProvider,
  azureProvider,
  findBuiltinAiProvider,
  gatewayProvider,
  googleProvider,
  openaiProvider,
} from "./providers/index.js";
import { createAiRegistry } from "./registry.js";

function customAdapter(provider: string, extra: Partial<AiProviderAdapter> = {}): AiProviderAdapter {
  return {
    provider,
    resolveConfig: vi.fn(() => undefined),
    createLanguageModel: vi.fn(() => ({ kind: "custom-language" }) as never),
    createEmbeddingModel: vi.fn(() => ({ kind: "custom-embedding" }) as never),
    ...extra,
  };
}

describe("built-in provider table", () => {
  it("lists the built-ins in display order", () => {
    expect(BUILTIN_AI_PROVIDER_NAMES).toEqual(["openai", "anthropic", "google", "azure", "gateway"]);
  });

  it("keeps each row consistent with its adapter", () => {
    for (const row of BUILTIN_AI_PROVIDERS) {
      expect(row.adapter.provider).toBe(row.provider);
      expect(row.adapter.aliases ?? []).toEqual(row.aliases);
      expect(row.adapter.configHint).toBe(row.configHint);
      expect(row.configHint).toContain(`ai.providerConfig.${row.provider}.apiKey`);
      expect(row.env.defaultModel.length).toBeGreaterThan(0);
      expect(row.env.apiKeyVars.length).toBeGreaterThan(0);
    }
  });

  it("names an @ai-sdk peer for every provider except the gateway, which ships with ai", () => {
    expect(
      Object.fromEntries(BUILTIN_AI_PROVIDERS.map((row) => [row.provider, row.peerPackage])),
    ).toEqual({
      openai: "@ai-sdk/openai",
      anthropic: "@ai-sdk/anthropic",
      google: "@ai-sdk/google",
      azure: "@ai-sdk/azure",
      gateway: undefined,
    });
  });

  it("finds rows by name or alias, case-insensitively", () => {
    expect(findBuiltinAiProvider("OpenAI")?.adapter).toBe(openaiProvider);
    expect(findBuiltinAiProvider(" foundry ")?.adapter).toBe(azureProvider);
    expect(findBuiltinAiProvider("azure-openai")?.adapter).toBe(azureProvider);
    expect(findBuiltinAiProvider("mistral")).toBeUndefined();
  });
});

describe("createAiRegistry built-ins", () => {
  it("registers every built-in provider and alias when called with no arguments", () => {
    const registry = createAiRegistry();
    for (const name of ["openai", "azure", "azure-openai", "foundry", "google", "anthropic", "gateway"]) {
      expect(registry.hasProvider(name), name).toBe(true);
    }
    expect(registry.hasProvider("mistral")).toBe(false);
  });

  it("registers only the named built-ins", () => {
    const registry = createAiRegistry(["openai"]);
    expect(registry.hasProvider("openai")).toBe(true);
    expect(registry.hasProvider("azure")).toBe(false);
    expect(registry.hasProvider("anthropic")).toBe(false);
  });

  it("registers a built-in by alias, including all of its aliases", () => {
    const registry = createAiRegistry(["Foundry"]);
    expect(registry.hasProvider("azure")).toBe(true);
    expect(registry.hasProvider("azure-openai")).toBe(true);
  });

  it("still accepts custom adapter objects unchanged", async () => {
    const adapter = customAdapter("mistral");
    const registry = createAiRegistry([adapter]);
    expect(registry.hasProvider("mistral")).toBe(true);
    await expect(
      registry.createLanguageModel({ provider: "mistral", apiKey: "k", model: "m" }),
    ).resolves.toEqual({ kind: "custom-language" });
  });

  it("mixes built-in names and custom adapters", () => {
    const registry = createAiRegistry(["openai", customAdapter("mistral")]);
    expect(registry.hasProvider("openai")).toBe(true);
    expect(registry.hasProvider("mistral")).toBe(true);
    expect(registry.hasProvider("google")).toBe(false);
  });

  it("lets a custom adapter override a built-in with the same name", async () => {
    const override = customAdapter("openai");
    const registry = createAiRegistry(["openai", override]);
    await expect(
      registry.createLanguageModel({ provider: "openai", apiKey: "k", model: "m" }),
    ).resolves.toEqual({ kind: "custom-language" });
  });

  it("throws for an unknown provider name, listing the built-ins", () => {
    expect(() => createAiRegistry(["mistral"])).toThrow(
      /"mistral" is not a built-in AI provider\. Built-in providers: openai, anthropic, google, azure, gateway\./,
    );
  });

  it("resolves config from env through the built-in adapters", () => {
    const registry = createAiRegistry();
    expect(registry.resolveAiConfig({ OPENAI_API_KEY: "sk" })).toEqual({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
    });
    expect(
      registry.resolveAiConfig({ ASKDB_AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "gw" }),
    ).toEqual({ provider: "gateway", apiKey: "gw", model: "openai/gpt-4o-mini" });
  });

  it("builds a model lazily from the installed peer SDK", async () => {
    const registry = createAiRegistry(["anthropic"]);
    const model = await registry.createLanguageModel({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    expect(model).toMatchObject({ provider: "anthropic.messages", modelId: "claude-sonnet-4-6" });
  });

  it("assembles a key-missing message from every built-in hint", () => {
    const message = createAiRegistry().keyMissingMessage("ctx");
    for (const adapter of [openaiProvider, anthropicProvider, googleProvider, azureProvider, gatewayProvider]) {
      expect(message).toContain(adapter.configHint);
    }
  });
});
