import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  resolveBaseConfig,
  type AiProviderAdapter,
  type ProviderEnvSpec,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"],
  modelVars: ["GOOGLE_AI_MODEL"],
  embeddingModelVars: ["GOOGLE_AI_EMBEDDING_MODEL"],
  baseURLVars: ["GOOGLE_AI_BASE_URL"],
  defaultModel: "gemini-2.0-flash",
};

export const googleProvider: AiProviderAdapter = {
  provider: "google",
  configHint:
    "For Google Gemini, set ai.provider: \"google\" and ai.providerConfig.google.apiKey in askdb.config.*.",
  resolveConfig(env, options) {
    return resolveBaseConfig("google", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return google(config.model);
  },
  createEmbeddingModel(config) {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return google.textEmbeddingModel(config.model);
  },
};
