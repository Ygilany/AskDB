import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import { openaiReasoningEffort } from "./openai-reasoning.js";
import { rethrowMissingPeer } from "./optional-peer.js";
import type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";

const PEER_PACKAGE = "@ai-sdk/openai";

const ENV_SPEC: BuiltinProviderEnvSpec = {
  apiKeyVars: ["OPENAI_API_KEY"],
  apiKeySecondaryVars: ["OPENAI_API_KEY_SECONDARY"],
  modelVars: ["OPENAI_MODEL"],
  embeddingModelVars: ["OPENAI_EMBEDDING_MODEL"],
  baseURLVars: ["OPENAI_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

const CONFIG_HINT =
  "For OpenAI, set ai.provider: \"openai\" and ai.providerConfig.openai.apiKey in askdb.config.*.";

async function createProvider(config: AiConfig) {
  const { createOpenAI } = await import("@ai-sdk/openai").catch(
    rethrowMissingPeer("openai", PEER_PACKAGE),
  );
  return createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
  configHint: CONFIG_HINT,
  resolveConfig(env, options) {
    return resolveBaseConfig("openai", env, ENV_SPEC, options);
  },
  async createLanguageModel(config) {
    const openai = await createProvider(config);
    return openai(config.model);
  },
  async createEmbeddingModel(config, options = {}) {
    const openai = await createProvider(config);
    const model = openai.embedding(config.model);
    return withEmbeddingProviderOptions(model, "openai", options);
  },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort) return undefined;
    const effort = openaiReasoningEffort(config.model, reasoningEffort);
    // `forceReasoning`: the SDK decides whether to send `reasoning` from its own model
    // table, and releases older than the one a host installed may not know a newer family
    // (gpt-6 before @ai-sdk/openai 4.0.60). AskDB has already established that the model
    // reasons, so say so.
    return effort ? { openai: { reasoningEffort: effort, forceReasoning: true } } : undefined;
  },
};

export const openaiBuiltin: BuiltinAiProvider = {
  provider: "openai",
  label: "OpenAI",
  aliases: [],
  peerPackage: PEER_PACKAGE,
  env: ENV_SPEC,
  configHint: CONFIG_HINT,
  adapter: openaiProvider,
};
