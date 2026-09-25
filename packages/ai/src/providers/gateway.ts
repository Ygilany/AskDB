import { createGateway } from "ai";
import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
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
    return createProvider(config)(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    const model = createProvider(config).embeddingModel(config.model);
    // The gateway forwards `providerOptions` to the upstream provider. Only
    // OpenAI embedding models are known to accept `dimensions`/`user` under
    // `providerOptions.openai`; for other upstreams the options are not
    // forwarded rather than sent under a key the provider might ignore.
    if (!config.model.startsWith("openai/")) return model;
    return withEmbeddingProviderOptions(model, "openai", options);
  },
  // No `resolveProviderOptions` yet: reasoning effort is not mapped for
  // gateway models, so no reasoning options are sent.
};

export const gatewayBuiltin: BuiltinAiProvider = {
  provider: "gateway",
  label: "Vercel AI Gateway",
  aliases: [],
  peerPackage: undefined,
  env: ENV_SPEC,
  embeddings: true,
  configHint: CONFIG_HINT,
  adapter: gatewayProvider,
};
