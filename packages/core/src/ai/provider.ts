import type { EmbeddingModel, LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

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
export type AskDbAiProvider = "openai" | "azure";

export type AskDbAiConfig = {
  provider: AskDbAiProvider;
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

export type AskDbAiEnv = Record<string, string | undefined>;

export type ResolveAskDbAiConfigOptions = {
  /** Default model when no env override is set. */
  modelDefault?: string;
  /**
   * Per-app model env var checked first (e.g. `ASKDB_TUI_MODEL`, `ASKDB_STUDIO_MODEL`).
   * Falls through to `ASKDB_AI_MODEL`, `ASKDB_MODEL`, `OPENAI_MODEL`, `modelDefault`.
   */
  modelEnvVar?: string;
};

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function readProvider(env: AskDbAiEnv): AskDbAiProvider {
  const raw = (env.ASKDB_AI_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "" || raw === "openai") return "openai";
  if (raw === "azure" || raw === "azure-openai" || raw === "foundry") return "azure";
  throw new Error(
    `Unknown ASKDB_AI_PROVIDER "${env.ASKDB_AI_PROVIDER}". Expected "openai" or "azure".`,
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
 */
export function resolveAskDbAiConfig(
  env: AskDbAiEnv = process.env,
  options: ResolveAskDbAiConfigOptions = {},
): AskDbAiConfig | undefined {
  const provider = readProvider(env);

  const providerNativeKey =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY || env.AZURE_API_KEY
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
      ? env.AZURE_OPENAI_DEPLOYMENT || env.AZURE_DEPLOYMENT_NAME
      : env.OPENAI_MODEL;
  const model =
    perAppModel ||
    env.ASKDB_AI_MODEL ||
    env.ASKDB_MODEL ||
    providerNativeModel ||
    options.modelDefault ||
    DEFAULT_MODEL;

  const providerNativeBaseURL =
    provider === "azure"
      ? env.AZURE_OPENAI_BASE_URL || env.AZURE_OPENAI_ENDPOINT || env.AZURE_BASE_URL
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

export type ResolveAskDbEmbeddingConfigOptions = {
  /** Default embedding model/deployment when no env override is set. */
  modelDefault?: string;
  /**
   * Per-app embedding model env var checked first
   * (e.g. `ASKDB_STUDIO_RAG_EMBEDDER_MODEL`).
   */
  modelEnvVar?: string;
};

/**
 * Resolves an embedding model config from the same provider/key/base URL
 * connection as `resolveAskDbAiConfig`, but with embedding-specific model
 * precedence so chat model ids (for example `gpt-4o`) are not used as
 * embedding model ids by accident.
 */
export function resolveAskDbEmbeddingConfig(
  env: AskDbAiEnv = process.env,
  options: ResolveAskDbEmbeddingConfigOptions = {},
): AskDbAiConfig | undefined {
  const provider = readProvider(env);

  const providerNativeKey =
    provider === "azure"
      ? env.AZURE_OPENAI_API_KEY || env.AZURE_API_KEY
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

/** Build a {@link LanguageModel} from an already-resolved config. */
export async function createAskDbLanguageModel(
  config: AskDbAiConfig,
): Promise<LanguageModel> {
  if (config.provider === "azure") {
    // Lazy-loaded so `@ai-sdk/azure` is only required when actually used.
    const { createAzure } = await import("@ai-sdk/azure");
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
    });
    return azure(config.model);
  }
  const openai = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return openai(config.model);
}

export type CreateAskDbEmbeddingModelOptions = {
  /** Optional dimensionality override for providers that support it. */
  dimensions?: number;
  /** Optional end-user id forwarded to providers that support it. */
  user?: string;
};

/** Build an AI SDK text embedding model from an already-resolved config. */
export async function createAskDbEmbeddingModel(
  config: AskDbAiConfig,
  options: CreateAskDbEmbeddingModelOptions = {},
): Promise<EmbeddingModel<string>> {
  if (config.provider === "azure") {
    const { createAzure } = await import("@ai-sdk/azure");
    const azure = createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
    });
    return azure.embedding(config.model, {
      dimensions: options.dimensions,
      user: options.user,
    });
  }
  const openai = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return openai.embedding(config.model, {
    dimensions: options.dimensions,
    user: options.user,
  });
}

/**
 * Convenience wrapper: resolve config from env, then construct a model.
 * Returns `undefined` when no API key is configured.
 */
export async function createAskDbLanguageModelFromEnv(
  env: AskDbAiEnv = process.env,
  options: ResolveAskDbAiConfigOptions = {},
): Promise<LanguageModel | undefined> {
  const config = resolveAskDbAiConfig(env, options);
  if (!config) return undefined;
  return createAskDbLanguageModel(config);
}

/** Resolve embedding config from env, then construct an AI SDK embedding model. */
export async function createAskDbEmbeddingModelFromEnv(
  env: AskDbAiEnv = process.env,
  options: ResolveAskDbEmbeddingConfigOptions & CreateAskDbEmbeddingModelOptions = {},
): Promise<EmbeddingModel<string> | undefined> {
  const config = resolveAskDbEmbeddingConfig(env, options);
  if (!config) return undefined;
  return createAskDbEmbeddingModel(config, options);
}

/**
 * Human-readable message describing how to configure AI, used by callers
 * when no key is configured.
 */
export function askDbAiKeyMissingMessage(context: string): string {
  return (
    `${context}: no AI API key configured. ` +
    `For OpenAI, set OPENAI_API_KEY (or ASKDB_AI_API_KEY). ` +
    `For Azure / Microsoft Foundry, set ASKDB_AI_PROVIDER=azure plus ` +
    `AZURE_OPENAI_API_KEY (or ASKDB_AI_API_KEY), ` +
    `ASKDB_AI_AZURE_RESOURCE_NAME (or ASKDB_AI_BASE_URL), and a deployment name ` +
    `via ASKDB_AI_MODEL.`
  );
}
