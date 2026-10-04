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
  defaultRagEmbeddingDimensions,
  parsePositiveInteger,
} from "./defaults.js";
import type { AskDbAiReasoningConfig, AskDbConfig } from "./types.js";

/** Every setting a built-in provider connection can carry, besides its name. */
const CONNECTION_FIELDS = ["apiKey", "secondaryApiKey", "resourceName", "baseUrl", "apiVersion"] as const;

type ConnectionSettings = { [Field in (typeof CONNECTION_FIELDS)[number]]?: string };

/** A provider connection after normalization: its settings, trimmed, plus its name. */
export type NormalizedAiConnection = ConnectionSettings & { name: string };

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
type RawConnection = ConnectionSettings & { name?: string; model?: string; modelFamily?: string };

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
/**
 * The width earlier AskDB versions assumed for a deprecated `rag.embedder` with no width set.
 * Only for telling users which width an existing index has; AskDB no longer assumes it.
 */
function widthEarlierVersionsAssumed(model: string): number {
  return defaultRagEmbeddingDimensions(model);
}

export function isMember<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
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
  for (const field of CONNECTION_FIELDS) {
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
 * A provider with named connections must name one `"default"` unless the section picks one. A
 * custom provider with no connection at all gets an empty one (AI then resolves as disabled, as
 * it always has); a built-in provider must have one.
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
  if (providerConnections && providerConnections.entries.length > 0) {
    throw new Error(
      `askdb.config: ai.providerConfig.${provider} has no connection named "default" ` +
        `(it has: ${connectionNames(providerConnections)}); name one "default" or set ai.${section}.connection.`,
    );
  }
  if (!isBuiltinProvider(provider)) return undefined;
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

/**
 * Reads a deprecated width key and warns that it's deprecated. A value that isn't a positive
 * integer is ignored, as it always was, and the warning says so.
 */
function readLegacyWidth(
  value: string | number | undefined,
  key: string,
  context: string,
  warn: (message: string) => void,
): number | undefined {
  if (value === undefined || String(value).trim() === "") return undefined;
  const parsed = parsePositiveInteger(value);
  warn(
    parsed === undefined
      ? `askdb.config: ${key} is deprecated${context}, and ignored because it isn't a positive integer; ` +
          "remove it, and set ai.embedding.dimensions if you need a width."
      : `askdb.config: ${key} is deprecated${context}; move it to ai.embedding.dimensions.`,
  );
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
 * Translates `rag.embedder: "openai" | "ai-sdk"` plus `rag.embedderConfig.openai`. A legacy key
 * or base URL moves to a connection of the embedding model's provider, and only for providers
 * that ever accepted an OpenAI-shaped key (#345).
 */
function translateLegacyEmbedder(
  embedder: "openai" | "ai-sdk",
  config: AskDbConfig,
  table: Map<string, ProviderConnections>,
  languageProvider: string,
  warn: (message: string) => void,
): LegacyEmbedding {
  const legacyOpenai = config.rag.embedderConfig?.openai ?? {};
  const provider = embedder === "openai" ? "openai" : languageProvider;
  warn(
    embedder === "openai"
      ? `askdb.config: rag.embedder "openai" is deprecated; use rag.embedder: "ai" with ai.embedding: { provider: "openai", model }.`
      : `askdb.config: rag.embedder "ai-sdk" is deprecated; use rag.embedder: "ai" with ai.embedding: { model }.`,
  );

  const legacyModel = nonBlank(legacyOpenai.model);
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

  const dimensions = readLegacyWidth(legacyOpenai.dimension, "rag.embedderConfig.openai.dimension", "", warn);

  const apiKey = nonBlank(legacyOpenai.apiKey);
  const baseUrl = nonBlank(legacyOpenai.baseUrl);
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
    const moveTo =
      `put it on a connection in ai.providerConfig.${provider} ` +
      `(and point ai.embedding.connection at that connection if it isn't the default one).`;
    if (apiKey !== undefined) warn(`askdb.config: rag.embedderConfig.openai.apiKey is deprecated; ${moveTo}`);
    if (baseUrl !== undefined) warn(`askdb.config: rag.embedderConfig.openai.baseUrl is deprecated; ${moveTo}`);
  }

  const providerConnections = table.get(provider);
  const defaultEntry = providerConnections?.entries.find((entry) => entry.connection.name === DEFAULT_CONNECTION);
  if (!defaultEntry) {
    if (apiKey === undefined && baseUrl === undefined && providerConnections && providerConnections.entries.length > 0) {
      // Named connections but none called "default": resolving the section reports their names.
      return { provider, model, dimensions, connection: undefined };
    }
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
 * Translates a legacy `model` or `modelFamily` on a connection. On the language section's
 * connection it's the language model (`modelFamily` only on Azure and Foundry), unless
 * `ai.language.<field>` is set to something else; on any other connection it was never read.
 * Returns the field's value for the language section.
 */
function translateLegacyLanguageField(
  field: "model" | "modelFamily",
  configured: string | undefined,
  table: Map<string, ProviderConnections>,
  languageEntry: ConnectionEntry | undefined,
  warn: (message: string) => void,
): string | undefined {
  const target = `ai.language.${field}`;
  let value = configured;
  for (const [provider, providerConnections] of table) {
    for (const entry of providerConnections.entries) {
      const legacy = nonBlank(entry.raw[field]);
      if (legacy === undefined) continue;
      const legacyKey = `${entry.label}.${field}`;
      const translates =
        entry === languageEntry && (field === "model" || provider === "azure" || provider === "foundry");
      if (!translates) {
        warn(
          `askdb.config: ${legacyKey} is deprecated and ignored (it isn't on the language model's connection); remove it.`,
        );
      } else if (value !== undefined && value !== legacy) {
        warn(`askdb.config: ${legacyKey} is deprecated and ignored because ${target} is set; remove it.`);
      } else {
        value = legacy;
        warn(`askdb.config: ${legacyKey} is deprecated; move it to ${target}.`);
      }
    }
  }
  return value;
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

  // The legacy `providerConfig.custom` is the connection of a custom `ai.provider`.
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

  // The legacy `ai.reasoning` is `ai.language.reasoning`.
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

  const model = translateLegacyLanguageField("model", nonBlank(language.model), table, languageEntry, warn);
  const modelFamily = translateLegacyLanguageField(
    "modelFamily",
    nonBlank(language.modelFamily),
    table,
    languageEntry,
    warn,
  );

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

    const legacy =
      rag.embedder === "openai" || rag.embedder === "ai-sdk"
        ? translateLegacyEmbedder(rag.embedder, config, table, languageProvider, warn)
        : undefined;
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

    // The legacy pgvector width moves to the embedding section.
    const pgvectorDimensions =
      rag.store === "pgvector"
        ? readLegacyWidth(
            rag.storeConfig.pgvector?.dimensions,
            "rag.storeConfig.pgvector.dimensions",
            ` with rag.embedder "${rag.embedder}"`,
            warn,
          )
        : undefined;
    if (pgvectorDimensions !== undefined) {
      if (dimensions !== undefined && dimensions !== pgvectorDimensions) {
        throw new Error(
          `askdb.config: ${dimensionsKey} is ${dimensions} but rag.storeConfig.pgvector.dimensions is ${pgvectorDimensions}; ` +
            `remove rag.storeConfig.pgvector.dimensions and keep one width in ai.embedding.dimensions.`,
        );
      }
      dimensions = pgvectorDimensions;
    }

    // AskDB assumes no width: it uses the one the model returns. The deprecated embedders assumed
    // one, so an index they built has it; say which, so the index can be kept or rebuilt.
    if (legacy && dimensions === undefined) {
      const earlierWidth = widthEarlierVersionsAssumed(embeddingModel);
      warn(
        `askdb.config: rag.embedder "${rag.embedder}" no longer assumes ${earlierWidth} dimensions for embedding model ` +
          `"${embeddingModel}"; AskDB now uses the width the model returns. An index built with an earlier AskDB ` +
          `version is ${earlierWidth} wide: to keep it, move to ai.embedding and set ai.embedding.dimensions: ${earlierWidth}. ` +
          `Otherwise rebuild the index.`,
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
