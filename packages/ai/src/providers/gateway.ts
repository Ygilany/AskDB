import { createGateway } from "ai";
import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import { openaiProvider } from "./openai.js";
import type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";

/**
 * Vercel AI Gateway. `createGateway` ships with `ai` itself (a required peer
 * of `@askdb/ai`), so this provider needs no extra package. Model ids are
 * `<upstream>/<model>`, e.g. `openai/gpt-4o-mini` or
 * `anthropic/claude-sonnet-4-6`.
 */
const ENV_SPEC: BuiltinProviderEnvSpec = {
  apiKeyVars: ["AI_GATEWAY_API_KEY"],
  defaultModel: "openai/gpt-4o-mini",
  defaultEmbeddingModel: "openai/text-embedding-3-small",
};

const CONFIG_HINT =
  "For Vercel AI Gateway, set ai.provider: \"gateway\" and ai.providerConfig.gateway.apiKey in askdb.config.*.";

/**
 * Upstreams whose provider options AskDB knows how to write. The gateway
 * forwards `providerOptions` to the upstream under the upstream's own key, so
 * each entry reuses that direct provider's mapping on the id after the prefix.
 */
const UPSTREAM_ADAPTERS: Record<string, AiProviderAdapter> = {
  openai: openaiProvider,
  google: googleProvider,
  anthropic: anthropicProvider,
};

/** Splits `openai/gpt-4o-mini` into `["openai", "gpt-4o-mini"]`; throws on an id with no upstream. */
function splitModelId(model: string): [upstream: string, upstreamModel: string] {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(
      `Vercel AI Gateway model ids are "<provider>/<model>" (e.g. "openai/gpt-4o-mini"), got "${model}". ` +
        "Set the model (ai.language.model, or ai.embedding.model for embeddings) to a prefixed id.",
    );
  }
  return [model.slice(0, slash), model.slice(slash + 1)];
}

function createProvider(config: AiConfig) {
  return createGateway({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

export const gatewayProvider: AiProviderAdapter = {
  provider: "gateway",
  configHint: CONFIG_HINT,
  resolveConfig(env, options) {
    return resolveBaseConfig("gateway", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    splitModelId(config.model);
    return createProvider(config)(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    const [upstream] = splitModelId(config.model);
    const model = createProvider(config).embeddingModel(config.model);
    // The gateway forwards `providerOptions` to the upstream under its own key,
    // so use the direct provider's names: `dimensions`/`user` for OpenAI,
    // `outputDimensionality` for Google (which has no per-end-user field).
    if (upstream === "openai") return withEmbeddingProviderOptions(model, "openai", options);
    if (upstream === "google") {
      return withEmbeddingProviderOptions(model, "google", options, ({ dimensions }) => ({
        outputDimensionality: dimensions,
      }));
    }
    // `user` is forwarded only where supported; a requested size is not
    // optional, so refuse rather than return vectors of the wrong length.
    if (options.dimensions !== undefined) {
      throw new Error(
        `AskDB can't send embedding dimensions to "${upstream}" models through the Vercel AI Gateway ` +
          '(it maps them for "openai/" and "google/" models). Unset ai.embedding.dimensions ' +
          "or use a supported upstream.",
      );
    }
    return model;
  },
  resolveProviderOptions(config, settings) {
    const [upstream, upstreamModel] = splitModelId(config.model);
    // Other upstreams get no reasoning options, the same as a direct model
    // that doesn't support reasoning tuning.
    return UPSTREAM_ADAPTERS[upstream]?.resolveProviderOptions?.(
      { ...config, provider: upstream, model: upstreamModel, providerOptions: undefined },
      settings,
    );
  },
};

export const gatewayBuiltin: BuiltinAiProvider = {
  provider: "gateway",
  label: "Vercel AI Gateway",
  aliases: [],
  peerPackage: undefined,
  env: ENV_SPEC,
  configHint: CONFIG_HINT,
  adapter: gatewayProvider,
};
