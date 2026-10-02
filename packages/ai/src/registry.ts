import type {
  AiConfig,
  AiEnv,
  AiProvider,
  AiProviderAdapter,
  AiProviderAdapters,
  AiProviderSelector,
  AiRegistry,
} from "./provider.js";
import {
  BUILTIN_AI_PROVIDERS,
  BUILTIN_AI_PROVIDER_NAMES,
  findBuiltinAiProvider,
} from "./providers/index.js";

/**
 * Builds a registry that resolves AskDB AI config from env and constructs
 * AI SDK models.
 *
 * - `createAiRegistry()` registers every provider built into `@askdb/ai`
 *   (see `BUILTIN_AI_PROVIDERS`). Each one loads its AI SDK package
 *   (`@ai-sdk/openai`, …) only when it first builds a model, so the host app
 *   installs only the SDKs it uses.
 * - `createAiRegistry(["openai", "anthropic"])` registers only the named
 *   built-ins. Aliases such as `"foundry"` work too.
 * - Adapter objects register custom providers and can be mixed with names:
 *   `createAiRegistry(["openai", myAdapter])`.
 */
export function createAiRegistry(adapters?: AiProviderAdapters): AiRegistry {
  const byProvider = normalizeAdapters(
    adapters ?? BUILTIN_AI_PROVIDERS.map((row) => row.adapter),
  );

  function adapterFor(provider: AiProvider): AiProviderAdapter {
    const adapter = byProvider.get(normalizeProvider(provider));
    if (!adapter) {
      throw new Error(aiProviderMissingMessage(provider));
    }
    return adapter;
  }

  function selectAdapter(env: AiEnv): AiProviderAdapter {
    const raw = normalizeProvider(env.ASKDB_AI_PROVIDER ?? "");
    const provider = raw || "openai";
    const adapter = byProvider.get(provider);
    if (!adapter) {
      if (raw) {
        throw new Error(
          `Unknown ASKDB_AI_PROVIDER "${env.ASKDB_AI_PROVIDER}". Registered providers: ${[
            ...byProvider.keys(),
          ].join(", ")}.`,
        );
      }
      throw new Error(aiProviderMissingMessage(provider));
    }
    return adapter;
  }

  function resolveAiConfig(
    env: AiEnv,
    options: { modelDefault?: string } = {},
  ): AiConfig | undefined {
    const adapter = selectAdapter(env);
    return adapter.resolveConfig(env, { usage: "language", ...options });
  }

  function resolveEmbeddingConfig(
    env: AiEnv,
    options: { modelDefault?: string; modelEnvVar?: string } = {},
  ): AiConfig | undefined {
    const adapter = selectAdapter(env);
    return adapter.resolveConfig(env, { usage: "embedding", ...options });
  }

  return {
    hasProvider(provider) {
      return byProvider.has(normalizeProvider(provider));
    },
    resolveAiConfig,
    resolveEmbeddingConfig,
    async createLanguageModel(config) {
      return adapterFor(config.provider).createLanguageModel(config);
    },
    async createEmbeddingModel(config, options = {}) {
      return adapterFor(config.provider).createEmbeddingModel(config, options);
    },
    async createLanguageModelFromEnv(env, options = {}) {
      const config = resolveAiConfig(env, options);
      if (!config) return undefined;
      return adapterFor(config.provider).createLanguageModel(config);
    },
    async createEmbeddingModelFromEnv(env, options = {}) {
      const config = resolveEmbeddingConfig(env, options);
      if (!config) return undefined;
      return adapterFor(config.provider).createEmbeddingModel(config, options);
    },
    resolveProviderOptions(config, settings) {
      return adapterFor(config.provider).resolveProviderOptions?.(config, settings);
    },
    keyMissingMessage(context: string): string {
      // Collect configHint from unique adapter objects (aliases share the same object).
      const seen = new Set<AiProviderAdapter>();
      const hints: string[] = [];
      for (const adapter of byProvider.values()) {
        if (!seen.has(adapter)) {
          seen.add(adapter);
          if (adapter.configHint) {
            hints.push(adapter.configHint);
          }
        }
      }
      if (hints.length === 0) {
        return aiKeyMissingMessage(context);
      }
      return `${context}: no AI API key configured. ${hints.join(" ")}`;
    },
  };
}

/**
 * Human-readable message describing how to configure AI, used by callers
 * when no key is configured. Lists the setup hint of every built-in provider.
 *
 * @deprecated Use {@link AiRegistry.keyMissingMessage}(context) instead.
 * The registry method assembles hints from registered adapters automatically.
 */
export function aiKeyMissingMessage(context: string): string {
  const hints = BUILTIN_AI_PROVIDERS.map((row) => row.configHint);
  return `${context}: no AI API key configured. ${hints.join(" ")}`;
}

/**
 * Message for a provider name that no registered adapter handles. For a
 * built-in provider (or alias) it says how to register it and which SDK
 * package to install; for anything else it points at the custom-adapter and
 * BYO-model paths.
 */
export function aiProviderMissingMessage(provider: AiProvider): string {
  const builtin = findBuiltinAiProvider(provider);
  if (builtin) {
    const install = builtin.peerPackage
      ? `, and install its SDK: npm i ${builtin.peerPackage}.`
      : ".";
    return (
      `AI provider "${provider}" is not registered. It is built into @askdb/ai: ` +
      `pass "${builtin.provider}" to createAiRegistry() (or call createAiRegistry() with no ` +
      `arguments to register every built-in provider)${install}`
    );
  }
  return (
    `AI provider "${provider}" is not registered. ` +
    `It is not built into @askdb/ai (built-in providers: ${BUILTIN_AI_PROVIDER_NAMES.join(", ")}): ` +
    `pass an AiProviderAdapter whose \`provider\` (or one of its \`aliases\`) is "${provider}" ` +
    `to createAiRegistry(), or pass an AI SDK LanguageModel to ask() directly.`
  );
}

function normalizeAdapters(
  adapters: AiProviderAdapters,
): Map<AiProvider, AiProviderAdapter> {
  const entries = isSelectorList(adapters)
    ? adapters.map((selector) => {
        const adapter = typeof selector === "string" ? builtinAdapter(selector) : selector;
        return [adapter.provider, adapter] as const;
      })
    : Object.entries(adapters).filter(isAdapterEntry);
  const byProvider = new Map<AiProvider, AiProviderAdapter>();
  for (const [provider, adapter] of entries) {
    if (adapter.provider !== provider) {
      throw new Error(
        `AI provider adapter mismatch: registry key "${provider}" points to adapter "${adapter.provider}".`,
      );
    }
    for (const name of [adapter.provider, ...(adapter.aliases ?? [])]) {
      byProvider.set(normalizeProvider(name), adapter);
    }
  }
  return byProvider;
}

function builtinAdapter(name: string): AiProviderAdapter {
  const builtin = findBuiltinAiProvider(name);
  if (!builtin) {
    throw new Error(
      `createAiRegistry: "${name}" is not a built-in AI provider. ` +
        `Built-in providers: ${BUILTIN_AI_PROVIDER_NAMES.join(", ")}. ` +
        `For any other provider, pass an AiProviderAdapter object instead of a name, ` +
        `or pass an AI SDK LanguageModel to ask() directly.`,
    );
  }
  return builtin.adapter;
}

function isSelectorList(
  adapters: AiProviderAdapters,
): adapters is readonly AiProviderSelector[] {
  return Array.isArray(adapters);
}

function normalizeProvider(provider: string): string {
  return provider.toLowerCase().trim();
}

function isAdapterEntry(
  entry: [string, AiProviderAdapter | undefined],
): entry is [AiProvider, AiProviderAdapter] {
  return entry[1] !== undefined;
}
