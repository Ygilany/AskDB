import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import { importOptionalPeer } from "./optional-peer.js";
import type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";

const PEER_PACKAGE = "@ai-sdk/azure";

const ENV_SPEC: BuiltinProviderEnvSpec = {
  apiKeyVars: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  apiKeySecondaryVars: ["AZURE_OPENAI_API_KEY_SECONDARY", "AZURE_API_KEY_SECONDARY"],
  modelVars: ["AZURE_OPENAI_DEPLOYMENT", "AZURE_DEPLOYMENT_NAME"],
  embeddingModelVars: [
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
    "AZURE_EMBEDDING_DEPLOYMENT_NAME",
  ],
  baseURLVars: ["AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "AZURE_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

/** o-series: `o1`, `o3`, `o3-mini`, `o4-mini`, … */
const O_SERIES_PATTERN = /^o\d+(?:-|$)/i;
/** `gpt-<major>[.<minor>][-<variant>]`, e.g. `gpt-5`, `gpt-5.1`, `gpt-5-mini`, `gpt-5-chat-latest`. */
const GPT_VERSION_PATTERN = /^gpt-(\d+)(?:\.\d+)?(?:-(.+))?$/i;

/**
 * Whether a model id belongs to a family that accepts `reasoningEffort`:
 * the o-series and gpt-5+ — except the `-chat` variants
 * (e.g. `gpt-5-chat-latest`), which are non-reasoning chat models. Mirrors
 * `getOpenAILanguageModelCapabilities` in `@ai-sdk/openai`, but conservatively
 * excludes every `-chat` variant (including minor versions such as
 * `gpt-5.1-chat-latest`) so AskDB never sends a reasoning knob a chat model
 * might reject.
 */
function isReasoningModel(model: string): boolean {
  if (O_SERIES_PATTERN.test(model)) return true;
  const gpt = GPT_VERSION_PATTERN.exec(model);
  if (!gpt) return false;
  if (Number(gpt[1]) < 5) return false;
  return !(gpt[2]?.toLowerCase().startsWith("chat") ?? false);
}

const ALIASES = ["azure-openai", "foundry"];

const CONFIG_HINT =
  "For Azure / Microsoft Foundry, set ai.provider: \"azure\" and ai.providerConfig.azure.apiKey in askdb.config.*.";

export const azureProvider: AiProviderAdapter = {
  provider: "azure",
  aliases: ALIASES,
  configHint: CONFIG_HINT,
  resolveConfig(env, options) {
    const config = resolveBaseConfig("azure", env, ENV_SPEC, options);
    if (!config) return undefined;

    const resourceName =
      env.ASKDB_AI_AZURE_RESOURCE_NAME || env.AZURE_RESOURCE_NAME || undefined;
    const apiVersion =
      env.ASKDB_AI_AZURE_API_VERSION ||
      env.AZURE_OPENAI_API_VERSION ||
      env.AZURE_API_VERSION ||
      undefined;
    const modelFamily = env.ASKDB_AI_AZURE_MODEL_FAMILY || undefined;

    if (!config.baseURL && !resourceName) {
      throw new Error(
        "Azure provider requires a resource name or endpoint URL. In askdb.config.*, set " +
          "ai.providerConfig.azure.resourceName (e.g. 'my-foundry' for " +
          "https://my-foundry.openai.azure.com) or ai.providerConfig.azure.baseUrl " +
          "(use providerConfig.foundry.* when ai.provider is \"foundry\"). " +
          "Without a config file, set the AZURE_RESOURCE_NAME or AZURE_OPENAI_BASE_URL " +
          "environment variable instead.",
      );
    }

    const providerOptions = {
      ...(resourceName ? { resourceName } : {}),
      ...(apiVersion ? { apiVersion } : {}),
      ...(modelFamily ? { modelFamily } : {}),
    };

    return {
      ...config,
      ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    };
  },
  async createLanguageModel(config) {
    const azure = await createProvider(config);
    return azure(config.model);
  },
  async createEmbeddingModel(config, options = {}) {
    const azure = await createProvider(config);
    const model = azure.embedding(config.model);
    // @ai-sdk/azure builds embeddings with OpenAIEmbeddingModel, which reads
    // only `providerOptions.openai` — an "azure" key would silently drop
    // `dimensions`/`user` (see the real-SDK contract test in contract.test.ts).
    return withEmbeddingProviderOptions(model, "openai", options);
  },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort) return undefined;
    // Azure deployment names are arbitrary aliases chosen at deploy time
    // (e.g. "askdb-reporting") and don't necessarily match the underlying
    // model id, so the o-series/gpt-5 regex can't reliably read `config.model`
    // alone. Callers can set ASKDB_AI_AZURE_MODEL_FAMILY (or
    // providerConfig.azure.modelFamily in askdb.config.*) to declare the true
    // backing model explicitly; we fall back to the deployment name otherwise.
    const modelFamily = readStringOption(config.providerOptions, "modelFamily") ?? config.model;
    if (!isReasoningModel(modelFamily)) return undefined;
    // `azure(model)` builds an OpenAIResponsesLanguageModel, which reads
    // `providerOptions.azure` and falls back to `providerOptions.openai` only
    // when no "azure" entry exists; `azure.chat(model)` (OpenAIChatLanguageModel)
    // reads only `providerOptions.openai`. Emitting the "openai" namespace
    // therefore works for both model kinds.
    //
    // `forceReasoning` is required because the AI SDK decides whether to send
    // `reasoning` from the model id it was constructed with — the Azure
    // deployment name — and silently drops `reasoningEffort` (with only a
    // warning) when that name doesn't look like a reasoning model. We have
    // already established reasoning support above (via modelFamily or the
    // deployment name), so tell the SDK explicitly.
    return { openai: { reasoningEffort, forceReasoning: true } };
  },
};

async function createProvider(config: AiConfig) {
  const { createAzure } = await importOptionalPeer("azure", PEER_PACKAGE, () => import("@ai-sdk/azure"));
  const { resourceName, apiVersion } = azureConnectionOptions(config);
  return createAzure({
    apiKey: config.apiKey,
    ...(resourceName ? { resourceName } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  });
}

function azureConnectionOptions(
  config: AiConfig,
): { resourceName?: string; apiVersion?: string } {
  return {
    resourceName: readStringOption(config.providerOptions, "resourceName"),
    apiVersion: readStringOption(config.providerOptions, "apiVersion"),
  };
}

function readStringOption(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

export const azureBuiltin: BuiltinAiProvider = {
  provider: "azure",
  label: "Azure OpenAI",
  aliases: ALIASES,
  aliasLabels: { foundry: "Azure AI Foundry" },
  peerPackage: PEER_PACKAGE,
  env: ENV_SPEC,
  embeddings: true,
  configHint: CONFIG_HINT,
  adapter: azureProvider,
};
