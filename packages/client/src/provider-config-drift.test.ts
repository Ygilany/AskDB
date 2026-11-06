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
import {
  AiBaseUrlCredentialsError,
  BUILTIN_AI_PROVIDERS,
  createAiRegistry,
  getBuiltinAiProviderSetup,
  type AiEnv,
} from "@askdb/ai";
import {
  ASKDB_AI_PROVIDERS,
  defineConfig,
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

const azureLike = (provider: string): boolean => provider === "azure" || provider === "foundry";

/** Azure and Foundry need a resource; the other providers ignore one. */
const AZURE_CONNECTION = { resourceName: "eastus", apiVersion: "2025-04-01-preview" };

/** The `ASKDB_AI_*` env a host without a config file sets for the same settings (`AZURE_CONNECTION` included). */
function universalEnv(provider: string, settings: AiEnv): AiEnv {
  return {
    ASKDB_AI_PROVIDER: provider,
    ...settings,
    ...(azureLike(provider)
      ? { ASKDB_AI_AZURE_RESOURCE_NAME: "eastus", ASKDB_AI_AZURE_API_VERSION: "2025-04-01-preview" }
      : {}),
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
      setAskDbRuntimeForTests(structured);
      const embedding = getAskDbRuntimeConfig().ai.embedding;
      expect(createAiRegistry().resolveEmbeddingConfig(embedding?.env ?? {})).toMatchObject({
        apiKey: "k",
        baseURL: "https://proxy.example/v1",
        model: "not-a-default-embedding-model",
      });
    },
  );

  // A host with a config file passes `rt.ai.language` / `rt.ai.embedding` as typed sections; a host
  // without one sets env. Both must reach the same AiConfig, for every provider config knows.
  it.each([...ASKDB_AI_PROVIDERS])("the %s language section resolves as the env path does", (provider) => {
    setAskDbRuntimeForTests(
      configFor(
        provider,
        { apiKey: "k", baseUrl: "https://proxy.example/v1", ...(azureLike(provider) ? AZURE_CONNECTION : {}) },
        { language: { model: "not-a-default-model", ...(azureLike(provider) ? { modelFamily: "gpt-5" } : {}) } },
      ),
    );
    const registry = createAiRegistry();
    const fromSection = registry.resolveAiConfigFromSection(getAskDbRuntimeConfig().ai.language);
    const fromEnv = registry.resolveAiConfig(
      universalEnv(provider, {
        ASKDB_AI_API_KEY: "k",
        ASKDB_AI_BASE_URL: "https://proxy.example/v1",
        ASKDB_AI_MODEL: "not-a-default-model",
        ...(azureLike(provider) ? { ASKDB_AI_AZURE_MODEL_FAMILY: "gpt-5" } : {}),
      }),
    );
    expect(fromSection).toMatchObject({ apiKey: "k", baseURL: "https://proxy.example/v1", model: "not-a-default-model" });
    expect(fromSection).toEqual(fromEnv);
  });

  it.each(ASKDB_AI_PROVIDERS.filter((provider) => provider !== "anthropic"))(
    "the %s embedding section resolves as the env path does",
    (provider) => {
      setAskDbRuntimeForTests(
        configFor(
          provider,
          { apiKey: "k", baseUrl: "https://proxy.example/v1", ...(azureLike(provider) ? AZURE_CONNECTION : {}) },
          { embedding: { model: "not-a-default-embedding-model", dimensions: 8 } },
        ),
      );
      const registry = createAiRegistry();
      const fromSection = registry.resolveEmbeddingConfigFromSection(getAskDbRuntimeConfig().ai.embedding!);
      const fromEnv = registry.resolveEmbeddingConfig(
        universalEnv(provider, {
          ASKDB_AI_API_KEY: "k",
          ASKDB_AI_BASE_URL: "https://proxy.example/v1",
          ASKDB_AI_EMBEDDING_MODEL: "not-a-default-embedding-model",
        }),
      );
      expect(fromSection).toMatchObject({ apiKey: "k", model: "not-a-default-embedding-model" });
      expect(fromSection).toEqual(fromEnv);
    },
  );

  // config spells it `secondaryApiKey`; the runtime section and @askdb/ai spell it `apiKeySecondary`.
  it.each(["azure", "foundry"])("the %s connection's secondary key reaches the provider when it has no primary", (provider) => {
    setAskDbRuntimeForTests(configFor(provider, { secondaryApiKey: "k2", ...AZURE_CONNECTION }));
    const registry = createAiRegistry();
    const fromSection = registry.resolveAiConfigFromSection(getAskDbRuntimeConfig().ai.language);
    expect(fromSection?.apiKey).toBe("k2");
    expect(fromSection).toEqual(registry.resolveAiConfig(universalEnv(provider, { ASKDB_AI_API_KEY_SECONDARY: "k2" })));
  });

  // #787 / ADR 0036: config refuses it at load, naming the key; @askdb/ai refuses it on both of
  // its paths, naming the setting. None of them repeats the URL.
  it.each([...ASKDB_AI_PROVIDERS])("refuses a %s base URL with credentials at load, from a section and from env", (provider) => {
    const withCredentials = "http://admin:S3cret@proxy.example/v1";
    const extra = azureLike(provider) ? AZURE_CONNECTION : {};
    expect(() => defineConfig(configFor(provider, { apiKey: "k", baseUrl: withCredentials, ...extra }))).toThrow(
      new RegExp(`^askdb\\.config: ai\\.providerConfig\\.${provider}\\.baseUrl contains a username or password`),
    );

    const registry = createAiRegistry();
    const failures: unknown[] = [];
    for (const resolve of [
      () => registry.resolveAiConfigFromSection({ provider, connection: { apiKey: "k", baseUrl: withCredentials, ...extra } }),
      () => registry.resolveAiConfig(universalEnv(provider, { ASKDB_AI_API_KEY: "k", ASKDB_AI_BASE_URL: withCredentials })),
    ]) {
      try {
        resolve();
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures.map((error) => (error as AiBaseUrlCredentialsError).setting)).toEqual(["connection.baseUrl", "ASKDB_AI_BASE_URL"]);
    for (const error of failures) {
      expect(error).toBeInstanceOf(AiBaseUrlCredentialsError);
      expect((error as Error).message).not.toMatch(/S3cret|admin/);
    }
  });
});
