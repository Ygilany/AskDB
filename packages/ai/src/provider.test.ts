import { describe, expect, it, vi } from "vitest";
import {
  createAiRegistry,
  resolveBaseConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
} from "./provider.js";

const spec: ProviderEnvSpec = {
  apiKeyVars: ["NATIVE_API_KEY"],
  apiKeySecondaryVars: ["NATIVE_API_KEY_SECONDARY"],
  modelVars: ["NATIVE_MODEL"],
  embeddingModelVars: ["NATIVE_EMBEDDING_MODEL"],
  baseURLVars: ["NATIVE_BASE_URL"],
  defaultModel: "default-language",
  defaultEmbeddingModel: "default-embedding",
};

describe("resolveBaseConfig", () => {
  it("returns undefined when no key is configured", () => {
    expect(resolveBaseConfig("test", {}, spec, { usage: "language" })).toBeUndefined();
  });

  it("prefers universal and native API keys in the documented order", () => {
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "universal-primary",
          NATIVE_API_KEY: "native-primary",
          NATIVE_API_KEY_SECONDARY: "native-secondary",
          ASKDB_AI_API_KEY_SECONDARY: "universal-secondary",
        },
        spec,
        { usage: "language" },
      )?.apiKey,
    ).toBe("universal-primary");
    expect(
      resolveBaseConfig(
        "test",
        {
          NATIVE_API_KEY: "native-primary",
          NATIVE_API_KEY_SECONDARY: "native-secondary",
          ASKDB_AI_API_KEY_SECONDARY: "universal-secondary",
        },
        spec,
        { usage: "language" },
      )?.apiKey,
    ).toBe("native-primary");
    expect(
      resolveBaseConfig(
        "test",
        {
          NATIVE_API_KEY_SECONDARY: "native-secondary",
          ASKDB_AI_API_KEY_SECONDARY: "universal-secondary",
        },
        spec,
        { usage: "language" },
      )?.apiKey,
    ).toBe("native-secondary");
    expect(
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY_SECONDARY: "universal-secondary" },
        spec,
        { usage: "language" },
      )?.apiKey,
    ).toBe("universal-secondary");
  });

  it("resolves language models with universal precedence before native defaults", () => {
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "k",
          ASKDB_AI_MODEL: "askdb-ai",
          ASKDB_MODEL: "askdb",
          NATIVE_MODEL: "native",
        },
        spec,
        { usage: "language" },
      )?.model,
    ).toBe("askdb-ai");
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "k",
          ASKDB_MODEL: "askdb",
          NATIVE_MODEL: "native",
        },
        spec,
        { usage: "language" },
      )?.model,
    ).toBe("askdb");
    expect(
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY: "k", NATIVE_MODEL: "native" },
        spec,
        { usage: "language", modelDefault: "option-default" },
      )?.model,
    ).toBe("native");
    expect(
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY: "k" },
        spec,
        { usage: "language", modelDefault: "option-default" },
      )?.model,
    ).toBe("option-default");
    expect(
      resolveBaseConfig("test", { ASKDB_AI_API_KEY: "k" }, spec, {
        usage: "language",
      })?.model,
    ).toBe("default-language");
  });

  it("resolves embedding models with per-app and embedding-specific precedence", () => {
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "k",
          ASKDB_RAG_EMBEDDER_MODEL: "rag",
          ASKDB_AI_EMBEDDING_MODEL: "shared",
          ASKDB_EMBEDDING_MODEL: "legacy",
          NATIVE_EMBEDDING_MODEL: "native",
        },
        spec,
        { usage: "embedding", modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL" },
      )?.model,
    ).toBe("rag");
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "k",
          ASKDB_AI_EMBEDDING_MODEL: "shared",
          ASKDB_EMBEDDING_MODEL: "legacy",
          NATIVE_EMBEDDING_MODEL: "native",
        },
        spec,
        { usage: "embedding", modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL" },
      )?.model,
    ).toBe("shared");
    expect(
      resolveBaseConfig(
        "test",
        {
          ASKDB_AI_API_KEY: "k",
          ASKDB_EMBEDDING_MODEL: "legacy",
          NATIVE_EMBEDDING_MODEL: "native",
        },
        spec,
        { usage: "embedding" },
      )?.model,
    ).toBe("legacy");
    expect(
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY: "k", NATIVE_EMBEDDING_MODEL: "native" },
        spec,
        { usage: "embedding", modelDefault: "option-default" },
      )?.model,
    ).toBe("native");
    expect(
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY: "k" },
        spec,
        { usage: "embedding", modelDefault: "option-default" },
      )?.model,
    ).toBe("option-default");
  });

  it("prefers ASKDB_AI_BASE_URL over provider-native base URLs", () => {
    const cfg = resolveBaseConfig(
      "test",
      {
        ASKDB_AI_API_KEY: "k",
        ASKDB_AI_BASE_URL: "https://askdb.example/v1",
        NATIVE_BASE_URL: "https://native.example/v1",
      },
      spec,
      { usage: "language" },
    );
    expect(cfg?.baseURL).toBe("https://askdb.example/v1");
  });

  it("throws when no model can be resolved", () => {
    expect(() =>
      resolveBaseConfig(
        "test",
        { ASKDB_AI_API_KEY: "k" },
        { apiKeyVars: ["NATIVE_API_KEY"] },
        { usage: "embedding" },
      ),
    ).toThrowError(
      "test: no embedding model configured. Set ASKDB_AI_MODEL (or the provider's native model variable).",
    );
  });
});

describe("createAiRegistry", () => {
  it("creates language and embedding models with a registered provider", async () => {
    const languageModel = { kind: "language" };
    const embeddingModel = { kind: "embedding" };
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => undefined),
      createLanguageModel: vi.fn(() => languageModel as never),
      createEmbeddingModel: vi.fn(() => embeddingModel as never),
    };

    const registry = createAiRegistry([adapter]);

    await expect(
      registry.createLanguageModel({
        provider: "openai",
        apiKey: "k",
        model: "gpt-4o-mini",
      }),
    ).resolves.toBe(languageModel);
    await expect(
      registry.createEmbeddingModel(
        {
          provider: "openai",
          apiKey: "k",
          model: "text-embedding-3-small",
        },
        { dimensions: 256 },
      ),
    ).resolves.toBe(embeddingModel);
    expect(adapter.createEmbeddingModel).toHaveBeenCalledWith(
      { provider: "openai", apiKey: "k", model: "text-embedding-3-small" },
      { dimensions: 256 },
    );
  });

  it("defaults to openai when ASKDB_AI_PROVIDER is unset", () => {
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => ({ provider: "openai", apiKey: "k", model: "m" })),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };

    const registry = createAiRegistry([adapter]);

    expect(registry.resolveAiConfig({ ASKDB_AI_API_KEY: "k" })).toEqual({
      provider: "openai",
      apiKey: "k",
      model: "m",
    });
    expect(adapter.resolveConfig).toHaveBeenCalledWith(
      { ASKDB_AI_API_KEY: "k" },
      { usage: "language" },
    );
  });

  it("selects adapters by aliases", () => {
    const adapter: AiProviderAdapter = {
      provider: "azure",
      aliases: ["foundry"],
      resolveConfig: vi.fn(() => ({ provider: "azure", apiKey: "k", model: "m" })),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };

    const registry = createAiRegistry([adapter]);

    expect(registry.hasProvider("foundry")).toBe(true);
    expect(registry.resolveAiConfig({ ASKDB_AI_PROVIDER: "foundry" })?.provider).toBe(
      "azure",
    );
  });

  it("delegates registry resolution with the requested usage", () => {
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => ({ provider: "openai", apiKey: "k", model: "m" })),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };

    const registry = createAiRegistry([adapter]);

    registry.resolveAiConfig({ OPENAI_API_KEY: "k" }, { modelDefault: "chat" });
    registry.resolveEmbeddingConfig(
      { OPENAI_API_KEY: "k" },
      { modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL", modelDefault: "embed" },
    );

    expect(adapter.resolveConfig).toHaveBeenNthCalledWith(
      1,
      { OPENAI_API_KEY: "k" },
      { usage: "language", modelDefault: "chat" },
    );
    expect(adapter.resolveConfig).toHaveBeenNthCalledWith(
      2,
      { OPENAI_API_KEY: "k" },
      {
        usage: "embedding",
        modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL",
        modelDefault: "embed",
      },
    );
  });

  it("resolves env config before creating a model", async () => {
    const languageModel = { kind: "language" };
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => ({
        provider: "openai",
        apiKey: "k",
        model: "gpt-4.1",
      })),
      createLanguageModel: vi.fn(() => languageModel as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };

    const registry = createAiRegistry({ openai: adapter });

    await expect(
      registry.createLanguageModelFromEnv({
        OPENAI_API_KEY: "k",
        OPENAI_MODEL: "gpt-4.1",
      }),
    ).resolves.toBe(languageModel);
    expect(adapter.createLanguageModel).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: "k",
      model: "gpt-4.1",
    });
  });

  it("returns undefined when env config has no key", async () => {
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => undefined),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };
    const registry = createAiRegistry([adapter]);

    await expect(registry.createLanguageModelFromEnv({})).resolves.toBeUndefined();
  });

  it("throws an actionable error when a provider is not registered", async () => {
    const registry = createAiRegistry([]);
    await expect(
      registry.createLanguageModel({
        provider: "google",
        apiKey: "k",
        model: "gemini-2.0-flash",
      }),
    ).rejects.toThrow(/Install @askdb\/ai-google/);
  });

  it("lists registered providers when ASKDB_AI_PROVIDER is unknown", () => {
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => undefined),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };
    const registry = createAiRegistry([adapter]);

    expect(() =>
      registry.resolveAiConfig({ ASKDB_AI_PROVIDER: "bedrock" }),
    ).toThrowError(
      'Unknown ASKDB_AI_PROVIDER "bedrock". Registered providers: openai.',
    );
  });

  it("rejects mismatched object-map adapters", () => {
    const adapter: AiProviderAdapter = {
      provider: "openai",
      resolveConfig: vi.fn(() => undefined),
      createLanguageModel: vi.fn(() => ({}) as never),
      createEmbeddingModel: vi.fn(() => ({}) as never),
    };

    expect(() => createAiRegistry({ google: adapter })).toThrow(/adapter mismatch/);
  });
});
