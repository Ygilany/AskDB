/**
 * `@askdb/config` keeps its own AI provider list, default models, and env var
 * names: it is the zero-AI bootstrap layer and must not depend on `@askdb/ai`
 * at runtime. `@askdb/client` depends on both, so the guard that the two agree
 * lives here rather than as an upward edge from `@askdb/ai` to `@askdb/config`.
 *
 * Each `askdb.config.*` branch is flattened and then resolved by the registry
 * the client uses, so an env var name that `flatten.ts` writes but the
 * provider doesn't read (or the reverse) fails here.
 */
import { BUILTIN_AI_PROVIDERS, createAiRegistry, getBuiltinAiProviderSetup } from "@askdb/ai";
import { ASKDB_AI_PROVIDERS, flattenAskDbConfig, type AskDbConfig } from "@askdb/config";
import { describe, expect, it } from "vitest";

function configFor(provider: string, providerConfig: Record<string, string>): AskDbConfig {
  return {
    ai: { provider, providerConfig: { [provider]: providerConfig } } as AskDbConfig["ai"],
    introspection: {
      provider: "postgres",
      providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } },
      outputDir: "./askdb/",
    },
    rag: { embedder: "mock", embedderConfig: {}, store: "memory", storeConfig: { memory: {} } },
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

  it.each([...ASKDB_AI_PROVIDERS])(
    "the %s config branch round-trips its API key, base URL, and default model through the provider",
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
});
