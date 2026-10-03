/**
 * `@askdb/config` keeps its own AI provider list, default models, and env var
 * names: it is the zero-AI bootstrap layer and must not depend on `@askdb/ai`
 * at runtime. `@askdb/client` depends on both, so the guard that the two agree
 * lives here rather than as an upward edge from `@askdb/ai` to `@askdb/config`.
 *
 * Each provider's `askdb.config.*` connection is flattened (and, for embeddings, turned into
 * the `ai.embedding` env view) and then resolved by the registry the client uses, so an env
 * var name that `@askdb/config` writes but the provider doesn't read (or the reverse) fails here.
 */
import { BUILTIN_AI_PROVIDERS, createAiRegistry, getBuiltinAiProviderSetup } from "@askdb/ai";
import {
  ASKDB_AI_PROVIDERS,
  flattenAskDbConfig,
  getAskDbRuntimeConfig,
  resetAskDbRuntimeForTests,
  setAskDbRuntimeForTests,
  type AskDbConfig,
} from "@askdb/config";
import { afterEach, describe, expect, it } from "vitest";

function configFor(
  provider: string,
  connection: Record<string, string>,
  sections: Pick<AskDbConfig["ai"], "language" | "embedding"> = {},
): AskDbConfig {
  return {
    ai: { provider, providerConfig: { [provider]: connection }, ...sections },
    introspection: {
      provider: "postgres",
      providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
      outputDir: "./askdb/",
    },
    rag: { embedder: sections.embedding ? "ai" : "mock", store: "memory", storeConfig: { memory: {} } },
  };
}

describe("@askdb/config agrees with @askdb/ai's built-in provider table", () => {
  it("ASKDB_AI_PROVIDERS lists every built-in provider, and only built-in providers and aliases", () => {
    const configIds = new Set<string>(ASKDB_AI_PROVIDERS);
    for (const row of BUILTIN_AI_PROVIDERS) {
      expect(configIds.has(row.provider), `config is missing "${row.provider}"`).toBe(true);
    }
    for (const id of ASKDB_AI_PROVIDERS) {
      expect(getBuiltinAiProviderSetup(id), `config lists "${id}", which is not built in`).toBeDefined();
    }
  });

  afterEach(() => resetAskDbRuntimeForTests());

  it.each([...ASKDB_AI_PROVIDERS])(
    "the %s connection round-trips its API key, base URL, and default model through the provider",
    (provider) => {
      const azureLike = provider === "azure" || provider === "foundry";
      const flat = flattenAskDbConfig(
        configFor(provider, {
          apiKey: "k",
          baseUrl: "https://proxy.example/v1",
          ...(azureLike ? { resourceName: "my-resource" } : {}),
        }),
      );
      const resolved = createAiRegistry().resolveAiConfig(flat);
      const row = BUILTIN_AI_PROVIDERS.find((r) => r.provider === resolved?.provider);
      expect(resolved).toMatchObject({ apiKey: "k", baseURL: "https://proxy.example/v1" });
      expect(resolved?.model, "config's default model").toBe(row?.env.defaultModel);
    },
  );

  // A model the provider falls back to by default can't show which env var flatten wrote,
  // so this one is never a default.
  it.each([...ASKDB_AI_PROVIDERS])("the %s language model reaches the provider", (provider) => {
    const azureLike = provider === "azure" || provider === "foundry";
    const flat = flattenAskDbConfig(
      configFor(
        provider,
        { apiKey: "k", ...(azureLike ? { resourceName: "my-resource" } : {}) },
        { language: { model: "not-a-default-model" } },
      ),
    );
    expect(createAiRegistry().resolveAiConfig(flat)?.model).toBe("not-a-default-model");
  });

  // Anthropic has no embeddings API, so config refuses it as the ai.embedding provider.
  it.each(ASKDB_AI_PROVIDERS.filter((provider) => provider !== "anthropic"))(
    "the %s embedding env view round-trips its connection and embedding model through the provider",
    (provider) => {
      const azureLike = provider === "azure" || provider === "foundry";
      const structured = configFor(
        provider,
        { apiKey: "k", baseUrl: "https://proxy.example/v1", ...(azureLike ? { resourceName: "my-resource" } : {}) },
        { embedding: { model: "not-a-default-embedding-model", dimensions: 8 } },
      );
      setAskDbRuntimeForTests({ structured, flat: flattenAskDbConfig(structured) });
      const embedding = getAskDbRuntimeConfig().ai.embedding;
      expect(createAiRegistry().resolveEmbeddingConfig(embedding?.env ?? {})).toMatchObject({
        apiKey: "k",
        baseURL: "https://proxy.example/v1",
        model: "not-a-default-embedding-model",
      });
    },
  );
});
