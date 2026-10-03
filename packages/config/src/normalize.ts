import {
  ASKDB_AI_PROVIDERS,
  ASKDB_RAG_EMBEDDERS,
  ASKDB_REASONING_EFFORTS,
  type AskDbRagStore,
} from "./constants.js";
import {
  DEFAULT_ANTHROPIC_LANGUAGE_MODEL,
  DEFAULT_AZURE_OPENAI_DEPLOYMENT,
  DEFAULT_GATEWAY_LANGUAGE_MODEL,
  DEFAULT_GOOGLE_LANGUAGE_MODEL,
  DEFAULT_OPENAI_LANGUAGE_MODEL,
  DEFAULT_RAG_EMBEDDING_MODEL,
  knownEmbeddingDimensions,
  parsePositiveInteger,
} from "./defaults.js";
import type { AskDbAiReasoningConfig, AskDbConfig } from "./types.js";

/** A provider connection after normalization: every field a built-in connection can carry, trimmed, plus its name. */
export type NormalizedAiConnection = {
  name: string;
  apiKey?: string;
  secondaryApiKey?: string;
  resourceName?: string;
  baseUrl?: string;
  apiVersion?: string;
};

export type NormalizedAiLanguageSection = {
  provider: string;
  connection: NormalizedAiConnection;
  /** `ai.language.model`, else the provider's default language model (none for a custom provider). */
  model: string | undefined;
  modelFamily: string | undefined;
  reasoning: AskDbAiReasoningConfig | undefined;
};

export type NormalizedAiEmbeddingSection = {
  provider: string;
  connection: NormalizedAiConnection;
  model: string;
  /** The configured `ai.embedding.dimensions`; `undefined` leaves the width to the model. */
  dimensions: number | undefined;
};

/** {@link AskDbConfig} with every deprecated key translated and both AI sections resolved. */
export type NormalizedAskDbConfig = Omit<AskDbConfig, "ai" | "rag"> & {
  ai: {
    language: NormalizedAiLanguageSection;
    /** Undefined unless `rag.embedder` is `"ai"` (after translating the deprecated embedders). */
    embedding: NormalizedAiEmbeddingSection | undefined;
  };
  rag: {
    embedder: "mock" | "ai";
    store: AskDbRagStore;
    storeConfig: AskDbConfig["rag"]["storeConfig"];
  };
};

/** Fields a connection literal can hold, legacy model fields included. */
type RawConnection = {
  name?: string;
  apiKey?: string;
  secondaryApiKey?: string;
  resourceName?: string;
  baseUrl?: string;
  apiVersion?: string;
  model?: string;
  modelFamily?: string;
};

type ConnectionEntry = { raw: RawConnection; connection: NormalizedAiConnection; label: string };

type ProviderConnections = {
  entries: ConnectionEntry[];
  /** How messages name this provider's config, e.g. `ai.providerConfig.openai`. */
  label: string;
};

type SectionName = "language" | "embedding";

const DEFAULT_CONNECTION = "default";
/** Name of the connection a legacy RAG key moves to when it differs from the provider's default connection. */
const LEGACY_RAG_CONNECTION = "rag-embeddings";
/** Providers a legacy `rag.embedderConfig.openai` key or base URL can move to. */
const LEGACY_RAG_KEY_PROVIDERS = new Set(["openai", "azure", "foundry", "gateway"]);
/** Providers a legacy `"ai-sdk"` embedder without a model defaults to `text-embedding-3-small` on. */
const LEGACY_DEFAULT_EMBEDDING_MODEL_PROVIDERS = new Set(["openai", "azure", "foundry"]);
/** Width the deprecated embedders assumed for a model AskDB doesn't know. */
const LEGACY_EMBEDDING_DIMENSIONS = 1536;

function isMember<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function isBuiltinProvider(provider: string): boolean {
  return isMember(provider, ASKDB_AI_PROVIDERS);
}

function nonBlank(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function defaultLanguageModel(provider: string): string | undefined {
  switch (provider) {
    case "openai":
      return DEFAULT_OPENAI_LANGUAGE_MODEL;
    case "azure":
    case "foundry":
      return DEFAULT_AZURE_OPENAI_DEPLOYMENT;
    case "anthropic":
      return DEFAULT_ANTHROPIC_LANGUAGE_MODEL;
    case "google":
      return DEFAULT_GOOGLE_LANGUAGE_MODEL;
    case "gateway":
      return DEFAULT_GATEWAY_LANGUAGE_MODEL;
    default:
      return undefined;
  }
}

function toConnection(raw: RawConnection, name: string): NormalizedAiConnection {
  const connection: NormalizedAiConnection = { name };
  for (const field of ["apiKey", "secondaryApiKey", "resourceName", "baseUrl", "apiVersion"] as const) {
    const value = nonBlank(raw[field]);
    if (value !== undefined) connection[field] = value;
  }
  return connection;
}

function readConnections(config: AskDbConfig): Map<string, ProviderConnections> {
  const table = new Map<string, ProviderConnections>();
  for (const [provider, value] of Object.entries(config.ai.providerConfig ?? {})) {
    if (value === undefined || value === null) continue;
    const isList = Array.isArray(value);
    const list = (isList ? value : [value]) as readonly RawConnection[];
    const label = `ai.providerConfig.${provider}`;
    const entries: ConnectionEntry[] = [];
    for (const raw of list) {
      const name = nonBlank(raw.name) ?? DEFAULT_CONNECTION;
      if (entries.some((entry) => entry.connection.name === name)) {
        throw new Error(
          `askdb.config: ${label} has more than one connection named "${name}"; connection names must be unique within a provider.`,
        );
      }
      entries.push({
        raw,
        connection: toConnection(raw, name),
        label: isList ? `${label} connection "${name}"` : label,
      });
    }
    table.set(provider, { entries, label });
  }
  return table;
}

function connectionNames(provider: ProviderConnections | undefined): string {
  const names = provider?.entries.map((entry) => `"${entry.connection.name}"`) ?? [];
  return names.length > 0 ? names.join(", ") : "none";
}

/**
 * Looks up a section's connection: `connection` within `provider`, `"default"` when unnamed.
 * A custom provider with no `"default"` connection gets an empty one (AI then resolves as
 * disabled, as it always has); a built-in provider must have one.
 */
function resolveConnection(
  table: Map<string, ProviderConnections>,
  section: SectionName,
  provider: string,
  providerSource: string,
  connectionName: string | undefined,
): ConnectionEntry | undefined {
  const providerConnections = table.get(provider);
  const name = connectionName ?? DEFAULT_CONNECTION;
  const found = providerConnections?.entries.find((entry) => entry.connection.name === name);
  if (found) return found;
  if (connectionName !== undefined) {
    throw new Error(
      `askdb.config: ai.${section}.connection is "${connectionName}", but ai.providerConfig.${provider} ` +
        `has no connection by that name (it has: ${connectionNames(providerConnections)}).`,
    );
  }
  if (!isBuiltinProvider(provider)) return undefined;
  if (providerConnections && providerConnections.entries.length > 0) {
    throw new Error(
      `askdb.config: ai.providerConfig.${provider} has no connection named "default" ` +
        `(it has: ${connectionNames(providerConnections)}); name one "default" or set ai.${section}.connection.`,
    );
  }
  throw new Error(
    `askdb.config: ai.providerConfig.${provider} is required when ${providerSource} is "${provider}". ` +
      `(Did you put the settings under providerConfig.custom? That key was only for providers ` +
      `without a first-party package, and it's deprecated: key a custom provider's connection by its provider id.)`,
  );
}

function validateReasoning(reasoning: AskDbAiReasoningConfig | undefined, key: string): void {
  if (!reasoning) return;
  for (const value of [reasoning.effort, reasoning.nlToSql, reasoning.enrichment]) {
    if (value !== undefined && !isMember(value, ASKDB_REASONING_EFFORTS)) {
      throw new Error(
        `askdb.config: invalid ${key} value "${value}" (expected one of: ${ASKDB_REASONING_EFFORTS.join(", ")}).`,
      );
    }
  }
}

function parseConfiguredDimensions(value: string | number | undefined, key: string): number | undefined {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return undefined;
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) {
    throw new Error(`askdb.config: ${key} must be a positive integer (got ${JSON.stringify(value)}).`);
  }
  return parsed;
}

/** Whether `rag.embedderConfig` holds any value (an empty `{}`, or one of unset `env()` reads, doesn't). */
function hasLegacyEmbedderConfig(rag: AskDbConfig["rag"]): boolean {
  return Object.values(rag.embedderConfig ?? {}).some(
    (branch) =>
      branch !== undefined &&
      branch !== null &&
      Object.values(branch).some((value) => value !== undefined && String(value).trim() !== ""),
  );
}

/** The embedding section a deprecated `rag.embedder: "openai" | "ai-sdk"` config means. */
type LegacyEmbedding = {
  provider: string;
  model: string;
  dimensions: number | undefined;
  /** `undefined` for the provider's default connection. */
  connection: string | undefined;
};

/**
 * Translates `rag.embedder: "openai" | "ai-sdk"` plus `rag.embedderConfig.openai` (T5-T7).
 * A legacy key or base URL moves to a connection of the embedding provider, and only for
 * providers that ever accepted an OpenAI-shaped key (#345).
 */
function translateLegacyEmbedder(
  config: AskDbConfig,
  table: Map<string, ProviderConnections>,
  languageProvider: string,
  warn: (message: string) => void,
): LegacyEmbedding {
  const embedder = config.rag.embedder as "openai" | "ai-sdk";
  const eo = config.rag.embedderConfig?.openai ?? {};
  const provider = embedder === "openai" ? "openai" : languageProvider;
  warn(
    embedder === "openai"
      ? `askdb.config: rag.embedder "openai" is deprecated; use rag.embedder: "ai" with ai.embedding: { provider: "openai", model }.`
      : `askdb.config: rag.embedder "ai-sdk" is deprecated; use rag.embedder: "ai" with ai.embedding: { model }.`,
  );

  const legacyModel = nonBlank(eo.model);
  if (legacyModel !== undefined) {
    warn("askdb.config: rag.embedderConfig.openai.model is deprecated; move it to ai.embedding.model.");
  }
  let model = legacyModel;
  if (model === undefined) {
    if (!LEGACY_DEFAULT_EMBEDDING_MODEL_PROVIDERS.has(provider)) {
      throw new Error(
        `askdb.config: rag.embedder "${embedder}" embeds with "${provider}", which has no default embedding model; ` +
          `set rag.embedder: "ai" and ai.embedding.model.`,
      );
    }
    model = DEFAULT_RAG_EMBEDDING_MODEL;
  }

  const dimensions = parsePositiveInteger(eo.dimension);
  if (eo.dimension !== undefined && String(eo.dimension).trim() !== "") {
    warn("askdb.config: rag.embedderConfig.openai.dimension is deprecated; move it to ai.embedding.dimensions.");
  }

  const apiKey = nonBlank(eo.apiKey);
  const baseUrl = nonBlank(eo.baseUrl);
  if (apiKey !== undefined || baseUrl !== undefined) {
    if (!LEGACY_RAG_KEY_PROVIDERS.has(provider)) {
      throw new Error(
        `askdb.config: rag.embedderConfig.openai.apiKey and .baseUrl can only move to an openai, azure, foundry or gateway ` +
          `connection, but rag.embedder "${embedder}" embeds with "${provider}". Replace rag.embedderConfig with an ` +
          `ai.embedding section and a connection for its provider, for example:\n` +
          `  ai: {\n` +
          `    embedding: { provider: "openai", model: "text-embedding-3-small" },\n` +
          `    providerConfig: { openai: { apiKey: env("OPENAI_API_KEY") }, /* ...your ${provider} connection */ },\n` +
          `  },\n` +
          `  rag: { embedder: "ai", /* ...store */ },`,
      );
    }
    for (const field of ["apiKey", "baseUrl"] as const) {
      if (field === "apiKey" ? apiKey !== undefined : baseUrl !== undefined) {
        warn(
          `askdb.config: rag.embedderConfig.openai.${field} is deprecated; put it on a connection in ai.providerConfig.${provider} ` +
            `(and point ai.embedding.connection at that connection if it isn't the default one).`,
        );
      }
    }
  }

  const providerConnections = table.get(provider);
  const defaultEntry = providerConnections?.entries.find((entry) => entry.connection.name === DEFAULT_CONNECTION);
  if (!defaultEntry) {
    // A provider used only for embeddings: its legacy key (or nothing, as before) becomes the default connection.
    const raw: RawConnection = { apiKey, baseUrl };
    const entry = { raw, connection: toConnection(raw, DEFAULT_CONNECTION), label: `ai.providerConfig.${provider}` };
    if (providerConnections) providerConnections.entries.push(entry);
    else table.set(provider, { entries: [entry], label: entry.label });
  } else if (
    (apiKey !== undefined && apiKey !== defaultEntry.connection.apiKey) ||
    (baseUrl !== undefined && baseUrl !== defaultEntry.connection.baseUrl)
  ) {
    if (providerConnections!.entries.some((entry) => entry.connection.name === LEGACY_RAG_CONNECTION)) {
      throw new Error(
        `askdb.config: ai.providerConfig.${provider} already has a connection named "${LEGACY_RAG_CONNECTION}", so ` +
          `rag.embedderConfig.openai can't move there; put its key on a connection yourself and set ai.embedding.connection.`,
      );
    }
    // On Azure, a base URL overrides the resource name, as it did before.
    const connection: NormalizedAiConnection = {
      ...defaultEntry.connection,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      name: LEGACY_RAG_CONNECTION,
    };
    providerConnections!.entries.push({ raw: {}, connection, label: `ai.providerConfig.${provider}` });
    return { provider, model, dimensions, connection: LEGACY_RAG_CONNECTION };
  }
  return { provider, model, dimensions, connection: undefined };
}

/**
 * Translates every deprecated `ai` / `rag` key to the current shape and resolves the
 * `ai.language` and `ai.embedding` sections to a provider, a connection and a model. Pure: it
 * reads no environment, and returns one deprecation message per legacy key in use (each names
 * the old and new location, never a value). Throws `askdb.config: …` errors for a config that
 * can't load.
 */
export function normalizeAskDbConfig(config: AskDbConfig): {
  config: NormalizedAskDbConfig;
  deprecations: string[];
} {
  const deprecations: string[] = [];
  const warn = (message: string): void => {
    if (!deprecations.includes(message)) deprecations.push(message);
  };
  const ai = config.ai;
  const rag = config.rag;

  if (!isMember(rag.embedder, ASKDB_RAG_EMBEDDERS)) {
    throw new Error(
      `askdb.config: invalid rag.embedder "${rag.embedder}" (expected one of: ${ASKDB_RAG_EMBEDDERS.join(", ")}).`,
    );
  }

  const table = readConnections(config);
  const topProvider = nonBlank(ai.provider);

  // T4: `providerConfig.custom` is the connection of a custom `ai.provider`.
  const custom = table.get("custom");
  if (custom && topProvider !== undefined && topProvider !== "custom" && !isBuiltinProvider(topProvider)) {
    if (table.has(topProvider)) {
      throw new Error(
        `askdb.config: ai.providerConfig.custom and ai.providerConfig.${topProvider} are both set; remove the legacy providerConfig.custom.`,
      );
    }
    warn(
      `askdb.config: ai.providerConfig.custom is deprecated; key the connection by its provider id: ai.providerConfig.${topProvider}.`,
    );
    table.delete("custom");
    table.set(topProvider, custom);
  }

  // T3: `ai.reasoning` → `ai.language.reasoning`.
  const language = ai.language ?? {};
  if (ai.reasoning !== undefined && language.reasoning !== undefined) {
    throw new Error(
      "askdb.config: ai.reasoning and ai.language.reasoning are both set; remove the legacy ai.reasoning.",
    );
  }
  if (ai.reasoning !== undefined) {
    warn("askdb.config: ai.reasoning is deprecated; move it to ai.language.reasoning.");
  }
  validateReasoning(language.reasoning, "ai.language.reasoning");
  validateReasoning(ai.reasoning, "ai.reasoning");
  const reasoning = language.reasoning ?? ai.reasoning;

  // Language section.
  const languageProviderOwn = nonBlank(language.provider);
  const languageProvider = languageProviderOwn ?? topProvider;
  if (languageProvider === undefined) {
    throw new Error("askdb.config: ai.language has no provider; set ai.language.provider or ai.provider.");
  }
  const languageEntry = resolveConnection(
    table,
    "language",
    languageProvider,
    languageProviderOwn !== undefined ? "ai.language.provider" : "ai.provider",
    nonBlank(language.connection),
  );

  // T1 / T2: a legacy `model` / `modelFamily` on the language connection is the language model;
  // on any other connection it was never read.
  let model = nonBlank(language.model);
  let modelFamily = nonBlank(language.modelFamily);
  for (const [provider, providerConnections] of table) {
    for (const entry of providerConnections.entries) {
      const isLanguageConnection = provider === languageProvider && entry === languageEntry;
      for (const [field, target] of [
        ["model", "ai.language.model"],
        ["modelFamily", "ai.language.modelFamily"],
      ] as const) {
        const legacy = nonBlank(entry.raw[field]);
        if (legacy === undefined) continue;
        const legacyKey = `${entry.label}.${field}`;
        const translates =
          isLanguageConnection && (field === "model" || provider === "azure" || provider === "foundry");
        if (!translates) {
          warn(
            `askdb.config: ${legacyKey} is deprecated and ignored (it isn't on the language model's connection); remove it.`,
          );
          continue;
        }
        const current = field === "model" ? model : modelFamily;
        if (current === undefined) {
          if (field === "model") model = legacy;
          else modelFamily = legacy;
          warn(`askdb.config: ${legacyKey} is deprecated; move it to ${target}.`);
        } else if (current !== legacy) {
          warn(`askdb.config: ${legacyKey} is deprecated and ignored because ${target} is set; remove it.`);
        } else {
          warn(`askdb.config: ${legacyKey} is deprecated; move it to ${target}.`);
        }
      }
    }
  }

  const languageSection: NormalizedAiLanguageSection = {
    provider: languageProvider,
    connection: languageEntry?.connection ?? { name: DEFAULT_CONNECTION },
    model: model ?? defaultLanguageModel(languageProvider),
    modelFamily,
    reasoning,
  };

  // Embedding section.
  const legacyEmbedder = rag.embedder === "openai" || rag.embedder === "ai-sdk";
  const hasLegacyConfig = hasLegacyEmbedderConfig(rag);
  let embedding: NormalizedAiEmbeddingSection | undefined;

  if (rag.embedder === "mock") {
    if (hasLegacyConfig) {
      warn('askdb.config: rag.embedderConfig is ignored because rag.embedder is "mock"; remove it.');
    }
  } else {
    if (legacyEmbedder && ai.embedding !== undefined) {
      throw new Error(
        `askdb.config: ai.embedding is set but rag.embedder is "${rag.embedder}"; set rag.embedder: "ai" and remove rag.embedderConfig.`,
      );
    }
    if (!legacyEmbedder && hasLegacyConfig) {
      throw new Error(
        'askdb.config: rag.embedderConfig is set but rag.embedder is "ai"; move its settings to ai.embedding and ai.providerConfig, then remove it.',
      );
    }

    const legacy = legacyEmbedder ? translateLegacyEmbedder(config, table, languageProvider, warn) : undefined;
    const section = ai.embedding ?? {};
    const embeddingModel = legacy?.model ?? nonBlank(section.model);
    if (embeddingModel === undefined) {
      throw new Error('askdb.config: rag.embedder is "ai" but ai.embedding.model is not set.');
    }
    const providerOwn = legacy?.provider ?? nonBlank(section.provider);
    const provider = providerOwn ?? topProvider;
    if (provider === undefined) {
      throw new Error("askdb.config: ai.embedding has no provider; set ai.embedding.provider or ai.provider.");
    }
    if (provider === "anthropic") {
      throw new Error(
        'askdb.config: anthropic has no embeddings API; set ai.embedding.provider (for example "openai") and give it a connection in ai.providerConfig.',
      );
    }
    const embeddingEntry = resolveConnection(
      table,
      "embedding",
      provider,
      providerOwn !== undefined ? "ai.embedding.provider" : "ai.provider",
      legacy ? legacy.connection : nonBlank(section.connection),
    );

    let dimensions = legacy ? legacy.dimensions : parseConfiguredDimensions(section.dimensions, "ai.embedding.dimensions");
    const dimensionsKey = legacy ? "rag.embedderConfig.openai.dimension" : "ai.embedding.dimensions";

    // T8: pgvector's width moves to the embedding section.
    const pgvectorDimensions =
      rag.store === "pgvector" ? parsePositiveInteger(rag.storeConfig.pgvector?.dimensions) : undefined;
    if (pgvectorDimensions !== undefined) {
      if (dimensions !== undefined && dimensions !== pgvectorDimensions) {
        throw new Error(
          `askdb.config: ${dimensionsKey} is ${dimensions} but rag.storeConfig.pgvector.dimensions is ${pgvectorDimensions}; ` +
            `remove rag.storeConfig.pgvector.dimensions and keep one width in ai.embedding.dimensions.`,
        );
      }
      dimensions = pgvectorDimensions;
      warn(
        `askdb.config: rag.storeConfig.pgvector.dimensions is deprecated with rag.embedder "${rag.embedder}"; move it to ai.embedding.dimensions.`,
      );
    }

    // The deprecated embedders assumed 1536 for a model AskDB doesn't know. Keep that, so an
    // index built with a legacy config keeps its width and its embedder id.
    if (legacy && dimensions === undefined && knownEmbeddingDimensions(provider, embeddingModel) === undefined) {
      dimensions = LEGACY_EMBEDDING_DIMENSIONS;
      warn(
        `askdb.config: rag.embedder "${rag.embedder}" assumes ${LEGACY_EMBEDDING_DIMENSIONS} dimensions for embedding model ` +
          `"${embeddingModel}"; when you move to ai.embedding, set ai.embedding.dimensions: ${LEGACY_EMBEDDING_DIMENSIONS} to keep the index you have.`,
      );
    }

    if (
      rag.store === "pgvector" &&
      dimensions === undefined &&
      knownEmbeddingDimensions(provider, embeddingModel) === undefined
    ) {
      throw new Error(
        `askdb.config: set ai.embedding.dimensions for embedding model "${embeddingModel}"; pgvector needs a fixed width.`,
      );
    }

    embedding = {
      provider,
      connection: embeddingEntry?.connection ?? { name: DEFAULT_CONNECTION },
      model: embeddingModel,
      dimensions,
    };
  }

  return {
    config: {
      ...config,
      ai: { language: languageSection, embedding },
      rag: { embedder: embedding ? "ai" : "mock", store: rag.store, storeConfig: rag.storeConfig },
    },
    deprecations,
  };
}
