import type { EmbeddingModel, LanguageModel } from "ai";

/**
 * AI provider selector. AskDB is BYO-LanguageModel at the function level
 * (see `ask()`), but the bundled apps (CLI, HTTP API, Studio, TUI) all need
 * to construct one from environment variables. This package now owns only the
 * universal AskDB precedence rules and registry dispatch. Individual provider
 * adapters own their native env vars, aliases, defaults, and connection
 * options.
 */
export type AiProvider = string;

export type AiConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Provider-specific connection settings, interpreted only by the owning adapter. */
  providerOptions?: Record<string, unknown>;
};

export type AiEnv = Record<string, string | undefined>;

export type AiUsage = "language" | "embedding";

export type ResolveConfigOptions = {
  usage: AiUsage;
  /** Default model when no env override is set. */
  modelDefault?: string;
  /** Per-app embedding model env var (e.g. `ASKDB_RAG_EMBEDDER_MODEL`). Embedding usage only. */
  modelEnvVar?: string;
};

/** Declarative description of one provider's native env vars, consumed by `resolveBaseConfig`. */
export type ProviderEnvSpec = {
  apiKeyVars: readonly string[];
  apiKeySecondaryVars?: readonly string[];
  modelVars?: readonly string[];
  embeddingModelVars?: readonly string[];
  baseURLVars?: readonly string[];
  defaultModel?: string;
  defaultEmbeddingModel?: string;
};

/**
 * Resolves the provider-neutral parts of an AI config from environment
 * variables. Returns `undefined` if no API key is configured (callers treat
 * this as "AI is disabled" rather than erroring, so AI features can be
 * optional).
 *
 * BYO-key design: each provider has its native env vars (for example
 * `OPENAI_API_KEY` for OpenAI). The `ASKDB_AI_*` family is a universal alias
 * set that works across providers, useful when a deployment wants one set of
 * names regardless of the selected provider.
 *
 * Precedence for the API key (within the selected provider):
 *   1. `ASKDB_AI_API_KEY`               - universal alias (primary)
 *   2. provider-native primary
 *   3. provider-native secondary
 *   4. `ASKDB_AI_API_KEY_SECONDARY`     - universal rotation fallback
 *
 * Precedence for language models:
 *   1. `ASKDB_AI_MODEL`
 *   2. `ASKDB_MODEL`
 *   3. provider-native language model vars
 *   4. `options.modelDefault`
 *   5. provider default language model
 *
 * Precedence for embedding models:
 *   1. `env[options.modelEnvVar]`
 *   2. `ASKDB_AI_EMBEDDING_MODEL`
 *   3. `ASKDB_EMBEDDING_MODEL`
 *   4. provider-native embedding model vars
 *   5. `options.modelDefault`
 *   6. provider default embedding model
 *
 * Precedence for base URLs:
 *   1. `ASKDB_AI_BASE_URL`
 *   2. provider-native base URL vars
 *
 * **Important:** Only `@askdb/config` reads `process.env` (during dotenv load
 * and while evaluating `askdb.config.*`). Pass
 * `getAskDbRuntimeConfig().ai.aiEnv` from `@askdb/config` after
 * `bootstrapAskDbEnv()`, or an explicit plain object in tests.
 */
export function resolveBaseConfig(
  provider: string,
  env: AiEnv,
  spec: ProviderEnvSpec,
  options: ResolveConfigOptions,
): AiConfig | undefined {
  const apiKey =
    first(env, ["ASKDB_AI_API_KEY"]) ||
    first(env, spec.apiKeyVars) ||
    first(env, spec.apiKeySecondaryVars ?? []) ||
    first(env, ["ASKDB_AI_API_KEY_SECONDARY"]) ||
    undefined;
  if (!apiKey) return undefined;

  const model = resolveModel(provider, env, spec, options);
  const baseURL =
    first(env, ["ASKDB_AI_BASE_URL"]) || first(env, spec.baseURLVars ?? []) || undefined;

  return {
    provider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
  };
}

function resolveModel(
  provider: string,
  env: AiEnv,
  spec: ProviderEnvSpec,
  options: ResolveConfigOptions,
): string {
  const model =
    options.usage === "embedding"
      ? first(env, options.modelEnvVar ? [options.modelEnvVar] : []) ||
        first(env, ["ASKDB_AI_EMBEDDING_MODEL"]) ||
        first(env, ["ASKDB_EMBEDDING_MODEL"]) ||
        first(env, spec.embeddingModelVars ?? []) ||
        options.modelDefault ||
        spec.defaultEmbeddingModel
      : first(env, ["ASKDB_AI_MODEL"]) ||
        first(env, ["ASKDB_MODEL"]) ||
        first(env, spec.modelVars ?? []) ||
        options.modelDefault ||
        spec.defaultModel;

  if (!model) {
    throw new Error(
      `${provider}: no ${options.usage} model configured. Set ASKDB_AI_MODEL (or the provider's native model variable).`,
    );
  }
  return model;
}

function first(env: AiEnv, vars: readonly string[]): string | undefined {
  for (const name of vars) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export type CreateEmbeddingModelOptions = {
  /** Optional dimensionality override for providers that support it. */
  dimensions?: number;
  /** Optional end-user id forwarded to providers that support it. */
  user?: string;
};

export type AiProviderAdapter = {
  provider: string;
  /** Additional ASKDB_AI_PROVIDER values that select this adapter. */
  aliases?: readonly string[];
  /**
   * Short human-readable setup hint shown when no API key is configured.
   * Used by {@link AiRegistry.keyMissingMessage} to build a composite message.
   * Example: "For OpenAI, set OPENAI_API_KEY (or ASKDB_AI_API_KEY)."
   */
  configHint?: string;
  /** Resolve an AiConfig from env. Return undefined when no API key is configured ("AI disabled"). */
  resolveConfig(env: AiEnv, options: ResolveConfigOptions): AiConfig | undefined;
  createLanguageModel(config: AiConfig): Promise<LanguageModel> | LanguageModel;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel> | EmbeddingModel;
};

export type AiProviderAdapters =
  | readonly AiProviderAdapter[]
  | Partial<Record<AiProvider, AiProviderAdapter>>;

export type AiRegistry = {
  hasProvider(provider: AiProvider): boolean;
  resolveAiConfig(
    env: AiEnv,
    options?: { modelDefault?: string },
  ): AiConfig | undefined;
  resolveEmbeddingConfig(
    env: AiEnv,
    options?: { modelDefault?: string; modelEnvVar?: string },
  ): AiConfig | undefined;
  createLanguageModel(config: AiConfig): Promise<LanguageModel>;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel>;
  createLanguageModelFromEnv(
    env: AiEnv,
    options?: { modelDefault?: string },
  ): Promise<LanguageModel | undefined>;
  createEmbeddingModelFromEnv(
    env: AiEnv,
    options?: { modelDefault?: string; modelEnvVar?: string } & CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel | undefined>;
  /**
   * Human-readable message describing how to configure AI for this registry.
   * Assembles configHint values from registered adapters (deduplicated, stable
   * registration order). Falls back to the static {@link aiKeyMissingMessage}
   * body when no adapter has a configHint.
   */
  keyMissingMessage(context: string): string;
};

export function createAiRegistry(
  adapters: AiProviderAdapters,
): AiRegistry {
  const byProvider = normalizeAdapters(adapters);

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
 * when no key is configured.
 *
 * @deprecated Use {@link AiRegistry.keyMissingMessage}(context) instead.
 * The registry method assembles hints from registered adapters automatically.
 */
export function aiKeyMissingMessage(context: string): string {
  return (
    `${context}: no AI API key configured. ` +
    `For OpenAI, set ai.provider: "openai" and ai.providerConfig.openai.apiKey in askdb.config.*. ` +
    `For Azure / Microsoft Foundry, set ai.provider: "azure" and ai.providerConfig.azure.apiKey in askdb.config.*. ` +
    `For Google Gemini, set ai.provider: "google" and ai.providerConfig.google.apiKey in askdb.config.*.`
  );
}

export function aiProviderMissingMessage(provider: AiProvider): string {
  return (
    `AI provider "${provider}" is not registered. ` +
    `Install @askdb/ai-${provider} and pass its provider adapter to createAiRegistry().`
  );
}

function normalizeAdapters(
  adapters: AiProviderAdapters,
): Map<AiProvider, AiProviderAdapter> {
  const entries = Array.isArray(adapters)
    ? adapters.map((adapter) => [adapter.provider, adapter] as const)
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

function normalizeProvider(provider: string): string {
  return provider.toLowerCase().trim();
}

function isAdapterEntry(
  entry: [string, AiProviderAdapter | undefined],
): entry is [AiProvider, AiProviderAdapter] {
  return entry[1] !== undefined;
}
