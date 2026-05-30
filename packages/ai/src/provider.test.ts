import { describe, expect, it } from "vitest";
import { resolveAskDbAiConfig, resolveAskDbEmbeddingConfig } from "./provider.js";

describe("resolveAskDbAiConfig", () => {
  it("returns undefined when no key is configured", () => {
    expect(resolveAskDbAiConfig({})).toBeUndefined();
  });

  it("defaults to the openai provider and the default model", () => {
    const cfg = resolveAskDbAiConfig({ ASKDB_AI_API_KEY: "k" });
    expect(cfg).toEqual({ provider: "openai", apiKey: "k", model: "gpt-4o-mini" });
  });

  it("prefers ASKDB_AI_API_KEY over the provider-native OPENAI_API_KEY and the secondary", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_API_KEY: "primary",
      OPENAI_API_KEY: "openai-native",
      ASKDB_AI_API_KEY_SECONDARY: "secondary",
    });
    expect(cfg?.apiKey).toBe("primary");
  });

  it("uses OPENAI_API_KEY as the provider-native key when ASKDB_AI_API_KEY is absent", () => {
    const cfg = resolveAskDbAiConfig({ OPENAI_API_KEY: "openai-native" });
    expect(cfg?.apiKey).toBe("openai-native");
  });

  it("uses AZURE_OPENAI_API_KEY as the provider-native key for azure", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "azure-native",
      ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
      OPENAI_API_KEY: "should-be-ignored",
    });
    expect(cfg?.apiKey).toBe("azure-native");
  });

  it("does not use OPENAI_API_KEY when the azure provider is selected", () => {
    expect(() =>
      resolveAskDbAiConfig({
        ASKDB_AI_PROVIDER: "azure",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        OPENAI_API_KEY: "openai-only",
      }),
    ).not.toThrow();
    expect(
      resolveAskDbAiConfig({
        ASKDB_AI_PROVIDER: "azure",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        OPENAI_API_KEY: "openai-only",
      }),
    ).toBeUndefined();
  });

  it("falls back to the secondary key after both the universal and provider-native keys are absent", () => {
    const cfg = resolveAskDbAiConfig({ ASKDB_AI_API_KEY_SECONDARY: "secondary" });
    expect(cfg?.apiKey).toBe("secondary");
  });

  it("uses OPENAI_API_KEY_SECONDARY as a provider-native rotation fallback", () => {
    const cfg = resolveAskDbAiConfig({ OPENAI_API_KEY_SECONDARY: "openai-secondary" });
    expect(cfg?.apiKey).toBe("openai-secondary");
  });

  it("uses AZURE_OPENAI_API_KEY_SECONDARY as a provider-native rotation fallback", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY_SECONDARY: "azure-secondary",
      ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
    });
    expect(cfg?.apiKey).toBe("azure-secondary");
  });

  it("recognizes AZURE_OPENAI_BASE_URL as the azure base URL", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "k",
      AZURE_OPENAI_BASE_URL: "https://my-foundry.services.ai.azure.com/openai/deployment/foo",
    });
    expect(cfg?.baseURL).toBe(
      "https://my-foundry.services.ai.azure.com/openai/deployment/foo",
    );
  });

  it("resolves the azure provider with resourceName + apiVersion", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "azure",
      ASKDB_AI_API_KEY: "k",
      ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
      ASKDB_AI_AZURE_API_VERSION: "2024-10-21",
      ASKDB_AI_MODEL: "gpt-4o-mini-deployment",
    });
    expect(cfg).toEqual({
      provider: "azure",
      apiKey: "k",
      model: "gpt-4o-mini-deployment",
      resourceName: "my-foundry",
      apiVersion: "2024-10-21",
    });
  });

  it("accepts the `foundry` alias for the azure provider", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "foundry",
      ASKDB_AI_API_KEY: "k",
      ASKDB_AI_BASE_URL: "https://my-foundry.services.ai.azure.com/openai/v1",
    });
    expect(cfg?.provider).toBe("azure");
    expect(cfg?.baseURL).toBe("https://my-foundry.services.ai.azure.com/openai/v1");
  });

  it("throws when azure is selected without resourceName or baseURL", () => {
    expect(() =>
      resolveAskDbAiConfig({ ASKDB_AI_PROVIDER: "azure", ASKDB_AI_API_KEY: "k" }),
    ).toThrowError(/Azure provider requires/);
  });

  it("throws on an unknown provider", () => {
    expect(() =>
      resolveAskDbAiConfig({ ASKDB_AI_PROVIDER: "bedrock", ASKDB_AI_API_KEY: "k" }),
    ).toThrowError(/Unknown ASKDB_AI_PROVIDER/);
  });

  it("resolves the google provider with GOOGLE_GENERATIVE_AI_API_KEY", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      GOOGLE_GENERATIVE_AI_API_KEY: "goog-key",
    });
    expect(cfg).toEqual({ provider: "google", apiKey: "goog-key", model: "gpt-4o-mini" });
  });

  it("uses GOOGLE_AI_API_KEY as an alias for the Google provider key", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      GOOGLE_AI_API_KEY: "goog-alias",
    });
    expect(cfg?.apiKey).toBe("goog-alias");
  });

  it("prefers ASKDB_AI_API_KEY over provider-native Google key", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      ASKDB_AI_API_KEY: "universal",
      GOOGLE_GENERATIVE_AI_API_KEY: "goog-native",
    });
    expect(cfg?.apiKey).toBe("universal");
  });

  it("uses GOOGLE_AI_MODEL as the provider-native model var for google", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      GOOGLE_GENERATIVE_AI_API_KEY: "k",
      GOOGLE_AI_MODEL: "gemini-1.5-pro",
    });
    expect(cfg?.model).toBe("gemini-1.5-pro");
  });

  it("passes through GOOGLE_AI_BASE_URL as baseURL for google", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      GOOGLE_GENERATIVE_AI_API_KEY: "k",
      GOOGLE_AI_BASE_URL: "https://custom.google.endpoint/v1",
    });
    expect(cfg?.baseURL).toBe("https://custom.google.endpoint/v1");
  });

  it("does not use OPENAI_API_KEY when the google provider is selected", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "google",
      OPENAI_API_KEY: "openai-only",
    });
    expect(cfg).toBeUndefined();
  });

  it("prefers ASKDB_AI_MODEL over ASKDB_MODEL and the provider-native model env var", () => {
    const cfg = resolveAskDbAiConfig({
      ASKDB_AI_API_KEY: "k",
      ASKDB_AI_MODEL: "from-new",
      ASKDB_MODEL: "from-askdb",
      OPENAI_MODEL: "from-openai",
    });
    expect(cfg?.model).toBe("from-new");
  });

  it("uses the provider-native model var only when ASKDB_AI_MODEL and ASKDB_MODEL are absent", () => {
    const openaiCfg = resolveAskDbAiConfig({ OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-4.1" });
    expect(openaiCfg?.model).toBe("gpt-4.1");

    const azureCfg = resolveAskDbAiConfig({
      ASKDB_AI_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "k",
      ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
      AZURE_OPENAI_DEPLOYMENT: "my-deployment",
    });
    expect(azureCfg?.model).toBe("my-deployment");
  });

});

describe("resolveAskDbEmbeddingConfig", () => {
  it("uses the configured OpenAI connection with the default embedding model", () => {
    const cfg = resolveAskDbEmbeddingConfig({
      ASKDB_AI_API_KEY: "k",
      ASKDB_AI_MODEL: "gpt-4o-mini",
      OPENAI_MODEL: "gpt-4.1",
    });
    expect(cfg).toEqual({
      provider: "openai",
      apiKey: "k",
      model: "text-embedding-3-small",
    });
  });

  it("prefers embedding-specific model env vars over chat model env vars", () => {
    const cfg = resolveAskDbEmbeddingConfig({
      OPENAI_API_KEY: "k",
      ASKDB_AI_MODEL: "gpt-4o-mini",
      ASKDB_AI_EMBEDDING_MODEL: "text-embedding-3-large",
      OPENAI_EMBEDDING_MODEL: "text-embedding-ada-002",
    });
    expect(cfg?.model).toBe("text-embedding-3-large");
  });

  it("honours a per-app embedding model override", () => {
    const cfg = resolveAskDbEmbeddingConfig(
      {
        ASKDB_AI_API_KEY: "k",
        ASKDB_AI_EMBEDDING_MODEL: "shared-embedding",
        ASKDB_RAG_EMBEDDER_MODEL: "rag-only",
      },
      { modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL" },
    );
    expect(cfg?.model).toBe("rag-only");
  });

  it("resolves Azure embedding deployments from the configured Azure connection", () => {
    const cfg = resolveAskDbEmbeddingConfig({
      ASKDB_AI_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "k",
      ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
      AZURE_OPENAI_DEPLOYMENT: "chat-deployment",
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "embedding-deployment",
    });
    expect(cfg).toEqual({
      provider: "azure",
      apiKey: "k",
      model: "embedding-deployment",
      resourceName: "my-foundry",
    });
  });
});
