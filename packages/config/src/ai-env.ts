import type { AskDbRuntimeAiConnection } from "./runtime-types.js";
import type { AskDbAiReasoningConfig } from "./types.js";

/** Every setting a built-in provider connection can carry, besides its name, as `askdb.config` spells it. */
export const CONNECTION_FIELDS = ["apiKey", "secondaryApiKey", "resourceName", "baseUrl", "apiVersion"] as const;

export type ConnectionSettings = { [Field in (typeof CONNECTION_FIELDS)[number]]?: string };

/** A provider connection after resolution: its settings, trimmed, plus its name. */
export type NormalizedAiConnection = AskDbRuntimeAiConnection;

/** Writes `value`, trimmed, under `key` unless it's unset or blank. */
export function setEnvKey(out: Record<string, string>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  const t = value.trim();
  if (t === "") return;
  out[key] = t;
}

/** Writes a connection's settings under the env keys `provider`'s `@askdb/ai` adapter reads. */
function applyAiConnection(out: Record<string, string>, provider: string, connection: NormalizedAiConnection): void {
  switch (provider) {
    case "openai":
      setEnvKey(out, "OPENAI_API_KEY", connection.apiKey);
      setEnvKey(out, "OPENAI_BASE_URL", connection.baseUrl);
      return;
    case "anthropic":
      setEnvKey(out, "ANTHROPIC_API_KEY", connection.apiKey);
      setEnvKey(out, "ANTHROPIC_BASE_URL", connection.baseUrl);
      return;
    case "google":
      setEnvKey(out, "GOOGLE_GENERATIVE_AI_API_KEY", connection.apiKey);
      setEnvKey(out, "GOOGLE_AI_BASE_URL", connection.baseUrl);
      return;
    case "gateway":
      setEnvKey(out, "AI_GATEWAY_API_KEY", connection.apiKey);
      setEnvKey(out, "ASKDB_AI_BASE_URL", connection.baseUrl);
      return;
    case "azure":
    case "foundry":
      // `@askdb/core` treats `foundry` like Azure for env parsing.
      setEnvKey(out, "AZURE_OPENAI_API_KEY", connection.apiKey);
      setEnvKey(out, "AZURE_OPENAI_API_KEY_SECONDARY", connection.apiKeySecondary);
      setEnvKey(out, "ASKDB_AI_AZURE_RESOURCE_NAME", connection.resourceName);
      setEnvKey(out, "AZURE_OPENAI_BASE_URL", connection.baseUrl);
      setEnvKey(out, "AZURE_OPENAI_API_VERSION", connection.apiVersion);
      return;
    default:
      // Custom/third-party provider: the universal ASKDB_AI_* keys that @askdb/ai's
      // resolveBaseConfig honors for every registered adapter. Works end to end only when the
      // host registry contains an adapter with this provider name.
      setEnvKey(out, "ASKDB_AI_API_KEY", connection.apiKey);
      setEnvKey(out, "ASKDB_AI_BASE_URL", connection.baseUrl);
  }
}

/** The `ai.language` section as the env view needs it. */
export type AiLanguageEnvSection = {
  provider: string;
  connection: NormalizedAiConnection;
  model: string | undefined;
  modelFamily: string | undefined;
  reasoning: AskDbAiReasoningConfig | undefined;
};

/** The `ai.embedding` section as the env view needs it. */
export type AiEmbeddingEnvSection = {
  provider: string;
  connection: NormalizedAiConnection;
  model: string;
};

function applyLanguageModel(out: Record<string, string>, section: AiLanguageEnvSection): void {
  const { provider, model } = section;
  if (provider === "openai") {
    setEnvKey(out, "OPENAI_MODEL", model);
    setEnvKey(out, "ASKDB_MODEL", model);
  } else if (provider === "azure" || provider === "foundry") {
    setEnvKey(out, "AZURE_OPENAI_DEPLOYMENT", model);
    setEnvKey(out, "AZURE_DEPLOYMENT_NAME", model);
    setEnvKey(out, "ASKDB_AI_MODEL", model);
    setEnvKey(out, "ASKDB_AI_AZURE_MODEL_FAMILY", section.modelFamily);
  } else {
    setEnvKey(out, "ASKDB_AI_MODEL", model);
  }
}

function applyReasoningAi(out: Record<string, string>, reasoning: AskDbAiReasoningConfig | undefined): void {
  if (!reasoning) return;
  setEnvKey(out, "ASKDB_AI_REASONING_EFFORT", reasoning.effort);
  setEnvKey(out, "ASKDB_AI_REASONING_EFFORT_NL_TO_SQL", reasoning.nlToSql);
  setEnvKey(out, "ASKDB_AI_REASONING_EFFORT_ENRICHMENT", reasoning.enrichment);
}

/** The env view of `ai.language`: its provider, its connection only, its model and reasoning. */
export function aiLanguageEnv(section: AiLanguageEnvSection): Record<string, string> {
  const out: Record<string, string> = {};
  setEnvKey(out, "ASKDB_AI_PROVIDER", section.provider);
  applyAiConnection(out, section.provider, section.connection);
  applyLanguageModel(out, section);
  applyReasoningAi(out, section.reasoning);
  return out;
}

/** The env view of `ai.embedding`: its provider, its connection only, and its model. Nothing from the language side. */
export function aiEmbeddingEnv(section: AiEmbeddingEnvSection): Record<string, string> {
  const out: Record<string, string> = {};
  setEnvKey(out, "ASKDB_AI_PROVIDER", section.provider);
  applyAiConnection(out, section.provider, section.connection);
  setEnvKey(out, "ASKDB_AI_EMBEDDING_MODEL", section.model);
  return out;
}
