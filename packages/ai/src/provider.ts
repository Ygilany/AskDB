import type { EmbeddingModel, LanguageModel } from "ai";

/**
 * AI provider selector. AskDB is BYO-LanguageModel at the function level
 * (see `ask()`), but the bundled apps (CLI, HTTP API, Studio, TUI) all need
 * to construct one from environment variables. This module is the single
 * place that does that, so adding a new provider only touches one file.
 *
 *  - `openai`  — OpenAI or any OpenAI-compatible REST endpoint
 *                (set `ASKDB_AI_BASE_URL` for compatible endpoints, including
 *                Azure AI Foundry's `/openai/v1` route and self-hosted gateways).
 *  - `azure`   — Azure OpenAI Service / Azure AI Foundry deployments via
 *                `@ai-sdk/azure`. Uses the `resourceName` + deployment-name
 *                URL shape with the `api-key` header.
 */
export type AiProvider = "openai" | "azure" | "google";

export type AiConfig = {
  provider: AiProvider;
  apiKey: string;
  /** OpenAI: model id (e.g. `gpt-4o-mini`). Azure: deployment name. */
  model: string;
  /** Custom REST base URL. Optional for OpenAI; for Azure, overrides resourceName. */
  baseURL?: string;
  /** Azure only: resource subdomain (e.g. `my-foundry` for `https://my-foundry.openai.azure.com`). */
  resourceName?: string;
  /** Azure only: API version (e.g. `2024-10-21`). */
  apiVersion?: string;
};

export type AiEnv = Record<string, string | undefined>;

export type ResolveAiConfigOptions = {
  /** Default model when no env override is set. */
  modelDefault?: string;
};

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function readProvider(env: AiEnv): AiProvider {
  const raw = (env.ASKDB_AI_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "" || raw === "openai") return "openai";
  if (raw === "azure" || raw === "azure-openai" || raw === "foundry") return "azure";
  if (raw === "google") return "google";
  throw new Error(
    `Unknown ASKDB_AI_PROVIDER "${env.ASKDB_AI_PROVIDER}". Expected "openai", "azure", or "google".`,
  );
}

/**
 * Resolves a provider config from environment variables. Returns `undefined`
 * if no API key is configured (callers treat this as "AI is disabled" rather
 * than erroring, so AI features can be optional).
 *
 * BYO-key design: each provider has its native env vars (e.g. `OPENAI_API_KEY`
 * for OpenAI, `AZURE_OPENAI_API_KEY` for Azure / Foundry). The `ASKDB_AI_*`
 * family is a universal alias set that works across providers — useful when
 * you want a single set of names across deployments.
 *
 * Precedence for the API key (within the selected provider):
 *   1. `ASKDB_AI_API_KEY`               — universal alias (primary)
 *   2. provider-native primary          — `OPENAI_API_KEY` or `AZURE_OPENAI_API_KEY` / `AZURE_API_KEY`
 *   3. provider-native secondary        — `OPENAI_API_KEY_SECONDARY` or `AZURE_OPENAI_API_KEY_SECONDARY`
 *   4. `ASKDB_AI_API_KEY_SECONDARY`     — universal rotation fallback
 *
 * **Important:** Only `@askdb/config` reads `process.env` (during dotenv load and while evaluating
 * `askdb.config.*`). Pass `getAskDbRuntimeConfig().ai.aiEnv` from `@askdb/config` after
 * `bootstrapAskDbEnv()`, or an explicit plain object in tests.
 *
 * @param env - String map in the shape of canonical AskDB env keys (from the runtime snapshot).
 * @param options - Optional per-app overrides (e.g. a per-app model env var).
 */
export function resolveAiConfig(
  env: AiEnv,
  options: ResolveAiConfigOptions = {},
): AiConfig | undefined {
  const provider = readProvider(env);

  const providerNativeKey =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY || env.AZURE_API_KEY
      : provider === "google"
        ? env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_AI_API_KEY
        : env.OPENAI_API_KEY;
  const providerNativeKeySecondary =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY_SECONDARY || env.AZURE_API_KEY_SECONDARY
      : env.OPENAI_API_KEY_SECONDARY;
  const apiKey =
    env.ASKDB_AI_API_KEY ||
    providerNativeKey ||
    providerNativeKeySecondary ||
    env.ASKDB_AI_API_KEY_SECONDARY ||
    undefined;
  if (!apiKey) return undefined;

  const providerNativeModel =
    provider === "azure"
      ? env.AZURE_OPENAI_DEPLOYMENT || env.AZURE_DEPLOYMENT_NAME
      : provider === "google"
        ? env.GOOGLE_AI_MODEL
        : env.OPENAI_MODEL;
  const model =
    env.ASKDB_AI_MODEL ||
    env.ASKDB_MODEL ||
    providerNativeModel ||
    options.modelDefault ||
    DEFAULT_MODEL;

  const providerNativeBaseURL =
    provider === "azure"
      ? env.AZURE_OPENAI_BASE_URL || env.AZURE_OPENAI_ENDPOINT || env.AZURE_BASE_URL
      : provider === "google"
        ? env.GOOGLE_AI_BASE_URL
        : env.OPENAI_BASE_URL;
  const baseURL = env.ASKDB_AI_BASE_URL || providerNativeBaseURL || undefined;

  const resourceName =
    env.ASKDB_AI_AZURE_RESOURCE_NAME || env.AZURE_RESOURCE_NAME || undefined;
  const apiVersion =
    env.ASKDB_AI_AZURE_API_VERSION || env.AZURE_OPENAI_API_VERSION || env.AZURE_API_VERSION || undefined;

  if (provider === "azure" && !baseURL && !resourceName) {
    throw new Error(
      "Azure provider requires ASKDB_AI_AZURE_RESOURCE_NAME (e.g. 'my-foundry') " +
        "or ASKDB_AI_BASE_URL pointing at the full endpoint.",
    );
  }

  return {
    provider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(resourceName ? { resourceName } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  };
}

export type ResolveEmbeddingConfigOptions = {
  /** Default embedding model/deployment when no env override is set. */
  modelDefault?: string;
  /**
   * Embedding model env var (e.g. `ASKDB_RAG_EMBEDDER_MODEL`).
   */
  modelEnvVar?: string;
};

/**
 * Resolves an embedding model config from the same provider/key/base URL
 * connection as `resolveAiConfig`, but with embedding-specific model
 * precedence so chat model ids (for example `gpt-4o`) are not used as
 * embedding model ids by accident.
 *
 * **Important:** Only `@askdb/config` reads `process.env` (during dotenv load and while evaluating
 * `askdb.config.*`). Pass `getAskDbRuntimeConfig().ai.aiEnv` from `@askdb/config` after
 * `bootstrapAskDbEnv()`, or an explicit plain object in tests.
 *
 * @param env - String map in the shape of canonical AskDB env keys (from the runtime snapshot).
 * @param options - Optional per-app overrides (e.g. a per-app embedding model env var).
 */
export function resolveEmbeddingConfig(
  env: AiEnv,
  options: ResolveEmbeddingConfigOptions = {},
): AiConfig | undefined {
  const provider = readProvider(env);

  const providerNativeKey =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY || env.AZURE_API_KEY
      : provider === "google"
        ? env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_AI_API_KEY
        : env.OPENAI_API_KEY;
  const providerNativeKeySecondary =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY_SECONDARY || env.AZURE_API_KEY_SECONDARY
      : env.OPENAI_API_KEY_SECONDARY;
  const apiKey =
    env.ASKDB_AI_API_KEY ||
    providerNativeKey ||
    providerNativeKeySecondary ||
    env.ASKDB_AI_API_KEY_SECONDARY ||
    undefined;
  if (!apiKey) return undefined;

  const perAppModel = options.modelEnvVar ? env[options.modelEnvVar] : undefined;
  const providerNativeModel =
    provider === "azure"
      ? env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
        env.AZURE_EMBEDDING_DEPLOYMENT_NAME
      : provider === "google"
        ? env.GOOGLE_AI_EMBEDDING_MODEL
        : env.OPENAI_EMBEDDING_MODEL;
  const model =
    perAppModel ||
    env.ASKDB_AI_EMBEDDING_MODEL ||
    env.ASKDB_EMBEDDING_MODEL ||
    providerNativeModel ||
    options.modelDefault ||
    DEFAULT_EMBEDDING_MODEL;

  const providerNativeBaseURL =
    provider === "azure"
      ? env.AZURE_OPENAI_BASE_URL || env.AZURE_OPENAI_ENDPOINT || env.AZURE_BASE_URL
      : provider === "google"
        ? env.GOOGLE_AI_BASE_URL
        : env.OPENAI_BASE_URL;
  const baseURL = env.ASKDB_AI_BASE_URL || providerNativeBaseURL || undefined;

  const resourceName =
    env.ASKDB_AI_AZURE_RESOURCE_NAME || env.AZURE_RESOURCE_NAME || undefined;
  const apiVersion =
    env.ASKDB_AI_AZURE_API_VERSION || env.AZURE_OPENAI_API_VERSION || env.AZURE_API_VERSION || undefined;

  if (provider === "azure" && !baseURL && !resourceName) {
    throw new Error(
      "Azure provider requires ASKDB_AI_AZURE_RESOURCE_NAME (e.g. 'my-foundry') " +
        "or ASKDB_AI_BASE_URL pointing at the full endpoint.",
    );
  }

  return {
    provider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
    ...(resourceName ? { resourceName } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  };
}

export type CreateEmbeddingModelOptions = {
  /** Optional dimensionality override for providers that support it. */
  dimensions?: number;
  /** Optional end-user id forwarded to providers that support it. */
  user?: string;
};

export type AiProviderAdapter = {
  provider: AiProvider;
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
  createLanguageModel(config: AiConfig): Promise<LanguageModel>;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel>;
  createLanguageModelFromEnv(
    env: AiEnv,
    options?: ResolveAiConfigOptions,
  ): Promise<LanguageModel | undefined>;
  createEmbeddingModelFromEnv(
    env: AiEnv,
    options?: ResolveEmbeddingConfigOptions & CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel | undefined>;
};

export function createAiRegistry(
  adapters: AiProviderAdapters,
): AiRegistry {
  const byProvider = normalizeAdapters(adapters);

  function adapterFor(provider: AiProvider): AiProviderAdapter {
    const adapter = byProvider.get(provider);
    if (!adapter) {
      throw new Error(aiProviderMissingMessage(provider));
    }
    return adapter;
  }

  return {
    hasProvider(provider) {
      return byProvider.has(provider);
    },
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
  };
}

/**
 * Human-readable message describing how to configure AI, used by callers
 * when no key is configured.
 */
export function aiKeyMissingMessage(context: string): string {
  return (
    `${context}: no AI API key configured. ` +
    `For OpenAI, set OPENAI_API_KEY (or ASKDB_AI_API_KEY). ` +
    `For Azure / Microsoft Foundry, set ASKDB_AI_PROVIDER=azure plus ` +
    `AZURE_OPENAI_API_KEY (or ASKDB_AI_API_KEY), ` +
    `ASKDB_AI_AZURE_RESOURCE_NAME (or ASKDB_AI_BASE_URL), and a deployment name ` +
    `via ASKDB_AI_MODEL. ` +
    `For Google Gemini, set ASKDB_AI_PROVIDER=google plus ` +
    `GOOGLE_GENERATIVE_AI_API_KEY (or ASKDB_AI_API_KEY).`
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
    byProvider.set(provider, adapter);
  }
  return byProvider;
}

function isAdapterEntry(
  entry: [string, AiProviderAdapter | undefined],
): entry is [AiProvider, AiProviderAdapter] {
  return entry[1] !== undefined;
}
