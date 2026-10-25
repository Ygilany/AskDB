import { describe, expect, it } from "vitest";
import { azureProvider } from "./azure.js";

describe("azureProvider", () => {
  it("resolves native Azure config into provider options", () => {
    const config = azureProvider.resolveConfig(
      {
        AZURE_OPENAI_API_KEY: "azure-native",
        OPENAI_API_KEY: "ignored",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        ASKDB_AI_AZURE_API_VERSION: "2024-10-21",
        AZURE_OPENAI_DEPLOYMENT: "chat-deployment",
      },
      { usage: "language" },
    );

    expect(config).toEqual({
      provider: "azure",
      apiKey: "azure-native",
      model: "chat-deployment",
      providerOptions: {
        resourceName: "my-foundry",
        apiVersion: "2024-10-21",
      },
    });
  });

  it("resolves Azure embedding deployments", () => {
    const config = azureProvider.resolveConfig(
      {
        AZURE_OPENAI_API_KEY: "k",
        ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        AZURE_OPENAI_DEPLOYMENT: "chat-deployment",
        AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "embedding-deployment",
      },
      { usage: "embedding" },
    );

    expect(config).toEqual({
      provider: "azure",
      apiKey: "k",
      model: "embedding-deployment",
      providerOptions: {
        resourceName: "my-foundry",
      },
    });
  });

  it("returns undefined when only OPENAI_API_KEY is configured for Azure", () => {
    expect(
      azureProvider.resolveConfig(
        {
          OPENAI_API_KEY: "openai-only",
          ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
        },
        { usage: "language" },
      ),
    ).toBeUndefined();
  });

  it("names the askdb.config keys (and env alternative) in the missing-resource error", () => {
    expect(() =>
      azureProvider.resolveConfig({ AZURE_OPENAI_API_KEY: "k" }, { usage: "language" }),
    ).toThrowError(
      /Azure provider requires.*ai\.providerConfig\.azure\.resourceName.*ai\.providerConfig\.azure\.baseUrl.*AZURE_RESOURCE_NAME/s,
    );
  });

  it("reads the resource name from AZURE_RESOURCE_NAME", () => {
    expect(
      azureProvider.resolveConfig(
        { AZURE_OPENAI_API_KEY: "k", AZURE_RESOURCE_NAME: "native-resource" },
        { usage: "language" },
      )?.providerOptions,
    ).toEqual({ resourceName: "native-resource" });
  });

  describe("resolveProviderOptions", () => {
    const baseConfig = { provider: "azure", apiKey: "k" } as const;

    it("maps reasoningEffort under the openai namespace for o-series deployments", () => {
      // The "openai" namespace is read by both azure(model) (Responses API,
      // which falls back to it when no "azure" entry exists) and
      // azure.chat(model) (Chat Completions, which reads only "openai").
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "o3-mini" },
          { reasoningEffort: "low" },
        ),
      ).toEqual({ openai: { reasoningEffort: "low", forceReasoning: true } });
    });

    it("returns undefined when reasoningEffort is unset", () => {
      expect(
        azureProvider.resolveProviderOptions?.({ ...baseConfig, model: "o3-mini" }, {}),
      ).toBeUndefined();
    });

    it("returns undefined for non-reasoning deployments (e.g. gpt-4o-mini)", () => {
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "gpt-4o-mini" },
          { reasoningEffort: "high" },
        ),
      ).toBeUndefined();
    });

    it("does not send reasoningEffort when modelFamily override names a non-reasoning model", () => {
      expect(
        azureProvider.resolveProviderOptions?.(
          { ...baseConfig, model: "o3-mini", providerOptions: { modelFamily: "gpt-4o-mini" } },
          { reasoningEffort: "low" },
        ),
      ).toBeUndefined();
    });

    it.each([
      ["gpt-5", true],
      ["gpt-4o", false],
    ] as const)("model family %s → reasoning: %s", (modelFamily, isReasoning) => {
      const result = azureProvider.resolveProviderOptions?.(
        { ...baseConfig, model: "askdb-reporting", providerOptions: { modelFamily } },
        { reasoningEffort: "medium" },
      );
      expect(result).toEqual(
        isReasoning ? { openai: { reasoningEffort: "medium", forceReasoning: true } } : undefined,
      );
    });
  });

  describe("resolveConfig — modelFamily", () => {
    it("resolves ASKDB_AI_AZURE_MODEL_FAMILY into providerOptions.modelFamily", () => {
      const config = azureProvider.resolveConfig(
        {
          AZURE_OPENAI_API_KEY: "k",
          ASKDB_AI_AZURE_RESOURCE_NAME: "my-foundry",
          AZURE_OPENAI_DEPLOYMENT: "askdb-reporting",
          ASKDB_AI_AZURE_MODEL_FAMILY: "gpt-5",
        },
        { usage: "language" },
      );
      expect(config?.providerOptions).toMatchObject({ modelFamily: "gpt-5" });
    });
  });
});
