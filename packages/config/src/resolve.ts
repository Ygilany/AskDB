import {
  ASKDB_AI_PROVIDERS,
  ASKDB_LOG_LEVELS,
  ASKDB_MODES_V1,
  ASKDB_RAG_EMBEDDERS,
  ASKDB_RAG_STORES,
  ASKDB_REASONING_EFFORTS,
  ASKDB_STUDIO_EXECUTE_PROVIDERS,
  type AskDbRagStore,
  type AskDbStudioExecuteProvider,
} from "./constants.js";
import {
  DEFAULT_ANTHROPIC_LANGUAGE_MODEL,
  DEFAULT_AZURE_OPENAI_DEPLOYMENT,
  DEFAULT_GATEWAY_LANGUAGE_MODEL,
  DEFAULT_GOOGLE_LANGUAGE_MODEL,
  DEFAULT_HTTP_API_HOST,
  DEFAULT_HTTP_API_PORT,
  DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS,
  DEFAULT_INTROSPECT_OUTPUT_DIR,
  DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_LANGUAGE_MODEL,
  DEFAULT_PGVECTOR_INDEX_STRATEGY,
  DEFAULT_STUDIO_EXECUTE_MAX_ROWS,
  DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS,
  MAX_HTTP_API_REQUEST_TIMEOUT_MS,
} from "./defaults.js";
import type {
  AskDbRuntimeAiConnection,
  AskDbRuntimeConfig,
  AskDbRuntimeHttpApiConfig,
  AskDbRuntimeIntrospectionConfig,
  AskDbRuntimeLoggingConfig,
  AskDbRuntimeModesConfig,
  AskDbRuntimeRagConfig,
  AskDbRuntimeStudioConfig,
} from "./runtime-types.js";
import type { AskDbAiReasoningConfig, AskDbConfig } from "./types.js";

/**
 * The config resolver: the one place that checks and defaults every `askdb.config` setting. Each setting's runtime value and its flat-map key come out of the same pass, so
 * `defineConfig` and `getAskDbRuntimeConfig` agree, and `@askdb/config` never reads a setting
 * back from a flat map.
 */

/** Every {@link AskDbRuntimeConfig} section, checked and defaulted. Not `structured`, `flat` or `deprecations`. */
type ResolvedAskDbConfig = Omit<AskDbRuntimeConfig, "structured" | "flat" | "deprecations">;

/** Every setting a built-in provider connection can carry, besides its name, as `askdb.config` spells it. */
const CONNECTION_FIELDS = ["apiKey", "secondaryApiKey", "resourceName", "baseUrl", "apiVersion"] as const;

type ConnectionSettings = { [Field in (typeof CONNECTION_FIELDS)[number]]?: string };

/** A provider connection after resolution: its settings, trimmed, plus its name. */
type NormalizedAiConnection = AskDbRuntimeAiConnection;

type NormalizedAiLanguageSection = {
  provider: string;
  connection: NormalizedAiConnection;
  /** `ai.language.model`, else the provider's default language model (none for a custom provider). */
  model: string | undefined;
  modelFamily: string | undefined;
  reasoning: AskDbAiReasoningConfig | undefined;
};

type NormalizedAiEmbeddingSection = {
  provider: string;
  connection: NormalizedAiConnection;
  model: string;
  /** The configured `ai.embedding.dimensions`; `undefined` leaves the width to the model. */
  dimensions: number | undefined;
};

/** The `ai` and `rag` blocks with both AI sections resolved and the `rag` default applied. */
type NormalizedAskDbConfig = {
  ai: {
    language: NormalizedAiLanguageSection;
    /** Undefined unless `rag.embedder` is `"ai"`. */
    embedding: NormalizedAiEmbeddingSection | undefined;
  };
  rag: {
    store: AskDbRagStore;
    storeConfig: NonNullable<AskDbConfig["rag"]>["storeConfig"];
  };
};

/** Fields a connection literal can hold. */
type RawConnection = ConnectionSettings & { name?: string };

type ConnectionEntry = { connection: NormalizedAiConnection; label: string };

type ProviderConnections = {
  entries: ConnectionEntry[];
  /** How messages name this provider's config, e.g. `ai.providerConfig.openai`. */
  label: string;
};

type SectionName = "language" | "embedding";

const DEFAULT_CONNECTION = "default";

function isMember<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return (allowed as readonly unknown[]).includes(value);
}

function isBuiltinProvider(provider: string): boolean {
  return isMember(provider, ASKDB_AI_PROVIDERS);
}

/**
 * A plain `{ ... }` object: not null, an array, a Promise or a module namespace. Read through
 * `Object.prototype.toString`, so an object from another realm still counts.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
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

/** The runtime name of each authored connection field: `secondaryApiKey` is `apiKeySecondary`, as `@askdb/ai` spells it. */
const RUNTIME_CONNECTION_FIELD = {
  apiKey: "apiKey",
  secondaryApiKey: "apiKeySecondary",
  resourceName: "resourceName",
  baseUrl: "baseUrl",
  apiVersion: "apiVersion",
} as const satisfies Record<(typeof CONNECTION_FIELDS)[number], keyof NormalizedAiConnection>;

function toConnection(raw: RawConnection, name: string): NormalizedAiConnection {
  const connection: NormalizedAiConnection = { name };
  for (const field of CONNECTION_FIELDS) {
    const value = nonBlank(raw[field]);
    if (value !== undefined) connection[RUNTIME_CONNECTION_FIELD[field]] = value;
  }
  return connection;
}

/**
 * Refuses a model base URL with a user name or password. `fetch` refuses it as well, and its error
 * quotes the whole URL, credentials included, so the error here names `key` and never the URL. A
 * value that doesn't parse counts when it holds an `@`. (`@askdb/ai` checks what reaches it the
 * same way, with `AiBaseUrlCredentialsError`.)
 */
function refuseBaseUrlCredentials(url: string | undefined, key: string): void {
  if (url === undefined) return;
  let credentials: boolean;
  try {
    const parsed = new URL(url);
    credentials = parsed.username !== "" || parsed.password !== "";
  } catch {
    credentials = url.includes("@");
  }
  if (credentials) {
    throw new Error(
      `askdb.config: ${key} contains a username or password, which AskDB won't send in a URL. Put the key in apiKey; ` +
        `to send other credentials, such as a proxy's, build the model in code with the AI SDK provider's headers option.`,
    );
  }
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
      const connection = toConnection(raw, name);
      refuseBaseUrlCredentials(connection.baseUrl, isList ? `${label}.baseUrl (connection "${name}")` : `${label}.baseUrl`);
      entries.push({
        connection,
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
    `askdb.config: ai.providerConfig.${provider} is required when ${providerSource} is "${provider}".`,
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
    throw new Error(`askdb.config: ${key} must be a positive integer (got ${describeValue(value)}).`);
  }
  return parsed;
}

/** Whether `object` has `key` at all. A removed key fails whatever its value, so an `env()` read left unset fails too. */
function hasKey(object: unknown, key: string): boolean {
  return isPlainObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Keys AskDB removed before 1.0 (#765). Each was deprecated, with a load warning naming its
 * replacement, from `@askdb/config` 1.0.0-beta.13 (`autoFlush` from beta.16). A config that sets
 * one fails to load with an error that names each such key and its replacement, never a value.
 */
function refuseRemovedKeys(config: AskDbConfig): void {
  const removed: { key: string; fix: string }[] = [];
  const ai = config.ai as AskDbConfig["ai"] & Record<string, unknown>;
  const rag = config.rag as (NonNullable<AskDbConfig["rag"]> & Record<string, unknown>) | null | undefined;

  if (hasKey(ai, "reasoning")) removed.push({ key: "ai.reasoning", fix: "move it to ai.language.reasoning." });

  const providerConfig = isPlainObject(ai.providerConfig) ? ai.providerConfig : {};
  const sectionProviders = [ai.provider, ai.language?.provider, ai.embedding?.provider].map((value) => nonBlank(value));
  if (hasKey(providerConfig, "custom") && !sectionProviders.includes("custom")) {
    const topProvider = nonBlank(ai.provider);
    const target = topProvider ?? "<provider>";
    removed.push({ key: "ai.providerConfig.custom", fix: `key the connection by its provider id, ai.providerConfig.${target}.` });
  }
  for (const [provider, value] of Object.entries(providerConfig)) {
    const list = Array.isArray(value) ? value : [value];
    for (const raw of list) {
      const named = Array.isArray(value) ? ` (connection "${nonBlank((raw as RawConnection)?.name) ?? DEFAULT_CONNECTION}")` : "";
      if (hasKey(raw, "model")) {
        removed.push({
          key: `ai.providerConfig.${provider}.model${named}`,
          fix: "a connection holds no model; set ai.language.model (or ai.embedding.model for the embedding model).",
        });
      }
      if (hasKey(raw, "modelFamily")) {
        removed.push({ key: `ai.providerConfig.${provider}.modelFamily${named}`, fix: "move it to ai.language.modelFamily." });
      }
    }
  }

  const embedder = rag?.embedder as unknown;
  if (embedder === "openai") {
    removed.push({ key: 'rag.embedder "openai"', fix: 'use rag.embedder: "ai" with ai.embedding: { provider: "openai", model }.' });
  } else if (embedder === "ai-sdk") {
    removed.push({ key: 'rag.embedder "ai-sdk"', fix: 'use rag.embedder: "ai" with ai.embedding: { model }.' });
  }
  if (hasKey(rag, "embedderConfig")) {
    removed.push({
      key: "rag.embedderConfig",
      fix: "set the embedding model and width in ai.embedding (model, dimensions), and its key and base URL on a connection in ai.providerConfig.",
    });
  }
  if (hasKey(rag?.storeConfig?.pgvector, "dimensions")) {
    removed.push({
      key: "rag.storeConfig.pgvector.dimensions",
      fix:
        "move it to ai.embedding.dimensions " +
        `(with rag.embedder: "mock" the vectors are always ${DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS} wide, so remove it).`,
    });
  }
  if (hasKey(rag?.storeConfig?.file, "autoFlush")) {
    removed.push({ key: "rag.storeConfig.file.autoFlush", fix: "remove it (the file store writes its files after every change)." });
  }

  if (removed.length === 1) {
    throw new Error(`askdb.config: ${removed[0]!.key} was removed; ${removed[0]!.fix}`);
  }
  if (removed.length > 1) {
    throw new Error(
      `askdb.config: this config sets ${removed.length} keys AskDB removed before 1.0:\n` +
        removed.map(({ key, fix }) => `  - ${key}: ${fix}`).join("\n"),
    );
  }
}

/**
 * Resolves the `ai.language` and `ai.embedding` sections to a provider, a connection and a model,
 * and applies the `rag` block's default. Pure: it reads no environment. Throws `askdb.config: …`
 * errors for a config that can't load, a removed key included.
 */
function normalizeAskDbConfig(config: AskDbConfig): NormalizedAskDbConfig {
  // The type requires both blocks, but a JS config (or a TS one run without a type check) can
  // leave one out. Name it here rather than crash on it below (#626).
  if (!isPlainObject(config.ai)) {
    throw new Error(
      'askdb.config: the config has no ai block; add ai: { provider, providerConfig: { <provider>: { apiKey } } }. ' +
        "AskDB needs it even when you only run askdb introspect.",
    );
  }
  if (!isPlainObject(config.introspection)) {
    throw new Error(
      "askdb.config: the config has no introspection block; add introspection: { provider, providerConfig }.",
    );
  }
  refuseRemovedKeys(config);
  const ai = config.ai;
  // An omitted `rag` block means "not using retrieval": the mock embedder and the in-memory store,
  // which write no store keys. This is the only place that default lives (#226): the flat map,
  // defineConfig and the runtime view (`rt.rag.store`) all read the normalized block.
  const authored: NonNullable<AskDbConfig["rag"]> = config.rag ?? { embedder: "mock", store: "memory", storeConfig: {} };
  // `storeConfig` is typed as required, but a JS config can leave it out (the memory store needs none).
  const rag = { ...authored, storeConfig: authored.storeConfig ?? {} };
  // The default can't be seen in the file, so refuse a config whose embedding model it would leave unused.
  if (
    (config.rag === undefined || config.rag === null) &&
    Object.values(ai.embedding ?? {}).some((value) => value !== undefined && value !== null && String(value).trim() !== "")
  ) {
    throw new Error(
      'askdb.config: ai.embedding is set but the config has no rag block; add rag: { embedder: "ai", store, storeConfig }, or remove ai.embedding.',
    );
  }

  if (!isMember(rag.embedder, ASKDB_RAG_EMBEDDERS)) {
    throw new Error(
      `askdb.config: invalid rag.embedder "${rag.embedder}" (expected one of: ${ASKDB_RAG_EMBEDDERS.join(", ")}).`,
    );
  }

  const table = readConnections(config);
  const topProvider = nonBlank(ai.provider);

  // Language section.
  const language = ai.language ?? {};
  validateReasoning(language.reasoning, "ai.language.reasoning");
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
  const languageSection: NormalizedAiLanguageSection = {
    provider: languageProvider,
    connection: languageEntry?.connection ?? { name: DEFAULT_CONNECTION },
    model: nonBlank(language.model) ?? defaultLanguageModel(languageProvider),
    modelFamily: nonBlank(language.modelFamily),
    reasoning: language.reasoning ? { ...language.reasoning } : undefined,
  };

  // Embedding section.
  let embedding: NormalizedAiEmbeddingSection | undefined;
  if (rag.embedder === "ai") {
    const section = ai.embedding ?? {};
    const embeddingModel = nonBlank(section.model);
    if (embeddingModel === undefined) {
      throw new Error('askdb.config: rag.embedder is "ai" but ai.embedding.model is not set.');
    }
    const providerOwn = nonBlank(section.provider);
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
      nonBlank(section.connection),
    );
    embedding = {
      provider,
      connection: embeddingEntry?.connection ?? { name: DEFAULT_CONNECTION },
      model: embeddingModel,
      dimensions: parseConfiguredDimensions(section.dimensions, "ai.embedding.dimensions"),
    };
  }

  return {
    ai: { language: languageSection, embedding },
    rag: { store: rag.store, storeConfig: rag.storeConfig },
  };
}

// ---------------------------------------------------------------------------
// Reading one value. Each reader names the config key in its error, never a flat key.
// ---------------------------------------------------------------------------

/**
 * A value for an error message: a string quoted, `null`, `undefined`, a number or a boolean as
 * written, anything else by its type. An object or a function is never printed, since its text
 * could hold a key or a connection string.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/**
 * A string key: trimmed, or `undefined` when unset (`undefined` or `null`) or blank. Any other
 * value fails: hosts read some string keys from the structured config as written (`host.*`,
 * `studio.listen.host`), so a wrong type must stop the load, not a later call.
 */
function readString(value: unknown, key: string): string | undefined {
  if (typeof value === "string") return nonBlank(value);
  if (value === undefined || value === null) return undefined;
  throw new Error(`askdb.config: invalid ${key} ${describeValue(value)} (expected a string).`);
}

/**
 * A boolean key must be `true`, `false` or unset. Anything else fails: the string `"false"` is
 * truthy, so reading it as a flag would turn the setting on.
 */
function readBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  throw new Error(`askdb.config: ${key} must be a boolean (got ${describeValue(value)}).`);
}

/** One of `allowed`, or `undefined` when unset (`undefined`, `null` or `""`). */
function readMember<T extends readonly string[]>(value: unknown, allowed: T, key: string): T[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (isMember(value, allowed)) return value;
  throw new Error(`askdb.config: invalid ${key} ${describeValue(value)} (expected one of: ${allowed.join(", ")}).`);
}

/** A list of strings, each trimmed, blanks dropped; `undefined` when unset or empty. */
function readStringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`askdb.config: invalid ${key} ${describeValue(value)} (expected an array of strings).`);
  }
  const list = (value as string[]).map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** A positive integer, or a string holding one; `undefined` for anything else. */
function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A positive-integer key, as a number or a string holding one. */
function readPositiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parsePositiveInteger(value);
  if (n === undefined) {
    throw new Error(`askdb.config: ${key} must be a positive integer (got ${describeValue(value)}).`);
  }
  return n;
}

/**
 * `httpApi.requestTimeoutMs`: `undefined` when unset; otherwise a positive integer no larger than
 * {@link MAX_HTTP_API_REQUEST_TIMEOUT_MS}, as a number or a string holding one.
 */
function readRequestTimeoutMs(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parsePositiveInteger(value);
  if (n === undefined || n > MAX_HTTP_API_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `askdb.config: invalid ${key} ${describeValue(value)} (expected a positive integer number of milliseconds, at most ${MAX_HTTP_API_REQUEST_TIMEOUT_MS}).`,
    );
  }
  return n;
}

/**
 * `httpApi.listen.port`: `undefined` when unset or `NaN` (`Number(env("PORT"))` with `PORT`
 * unset), as Studio does for `studio.listen.port`. Port `0` asks the OS for a free port. Anything
 * but an integer from 0 to 65535, or a string holding one, fails.
 */
function readListenPort(value: unknown, key: string): number | undefined {
  if (value === undefined || (typeof value === "number" && Number.isNaN(value))) return undefined;
  const text = typeof value === "string" ? value.trim() : undefined;
  // `Number("")` is 0, so a blank string is checked before it's converted.
  const port = typeof value === "number" ? value : text ? Number(text) : NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`askdb.config: invalid ${key} ${describeValue(value)} (expected an integer from 0 to 65535).`);
  }
  return port;
}

const PGVECTOR_INDEX_STRATEGIES = ["ivfflat", "hnsw", "none"] as const;
type PgvectorIndexStrategyId = (typeof PGVECTOR_INDEX_STRATEGIES)[number];

/**
 * `rag.storeConfig.pgvector.indexStrategy`, lowercased, or the default when unset or blank. A
 * value that isn't a string counts as unset.
 */
function pgvectorIndexStrategy(raw: unknown): PgvectorIndexStrategyId {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_PGVECTOR_INDEX_STRATEGY;
  const v = raw.trim().toLowerCase();
  if (isMember(v, PGVECTOR_INDEX_STRATEGIES)) return v;
  throw new Error(
    `askdb.config: invalid rag.storeConfig.pgvector.indexStrategy "${raw}" (expected one of: ${PGVECTOR_INDEX_STRATEGIES.join(", ")}).`,
  );
}

// ---------------------------------------------------------------------------
// One resolver per section. Each one checks its settings, returns its runtime section and writes
// its keys to the flat map. Most optional keys reach the flat map only when the config sets them,
// so a child process's env built from the map gets no defaults (`PORT=3000`); the runtime config
// applies those. Four keys are written with a default: `ASKDB_RAG_EMBEDDER` (`mock` without
// `ai.embedding`), `ASKDB_INTROSPECT_OUT` (`./askdb/`), and with the pgvector store
// `ASKDB_PGVECTOR_INDEX_STRATEGY` (`hnsw`) and, for the mock embedder, `ASKDB_RAG_EMBEDDER_DIMENSIONS`
// (`64`).
// ---------------------------------------------------------------------------

/** The flat map under construction: canonical env keys to trimmed values. */
type FlatMap = Record<string, string>;

/** Writes `value`, trimmed, under `key` unless it's unset or blank. */
function setFlat(flat: FlatMap, key: string, value: string | number | undefined): void {
  const trimmed = value === undefined ? "" : String(value).trim();
  if (trimmed !== "") flat[key] = trimmed;
}

function resolveIntrospection(intro: AskDbConfig["introspection"], flat: FlatMap): AskDbRuntimeIntrospectionConfig {
  const { provider } = intro;
  const engines = intro.providerConfig;
  // Only the active engine's connection is read, so other branches stay `undefined`.
  const connection = (engine: "postgres" | "mysql" | "sqlserver"): string | undefined =>
    provider === engine
      ? readString(engines?.[engine]?.databaseUrl, `introspection.providerConfig.${engine}.databaseUrl`)
      : undefined;
  const resolved: AskDbRuntimeIntrospectionConfig = {
    provider,
    postgresDatabaseUrl: connection("postgres"),
    prismaSchemaPath:
      provider === "prisma"
        ? readString(engines?.prisma?.schemaPath, "introspection.providerConfig.prisma.schemaPath")
        : undefined,
    mysqlDatabaseUrl: connection("mysql"),
    schemas: readStringList(intro.schemas, "introspection.schemas"),
    sqliteFile: provider === "sqlite" ? readString(engines?.sqlite?.file, "introspection.providerConfig.sqlite.file") : undefined,
    sqlserverDatabaseUrl: connection("sqlserver"),
    outputDir: readString(intro.outputDir, "introspection.outputDir") ?? DEFAULT_INTROSPECT_OUTPUT_DIR,
  };
  setFlat(flat, "ASKDB_INTROSPECT_POSTGRES_URL", resolved.postgresDatabaseUrl);
  setFlat(flat, "ASKDB_INTROSPECT_MYSQL_URL", resolved.mysqlDatabaseUrl);
  setFlat(flat, "ASKDB_INTROSPECT_SQLITE_FILE", resolved.sqliteFile);
  setFlat(flat, "ASKDB_INTROSPECT_SQLSERVER_URL", resolved.sqlserverDatabaseUrl);
  // The Prisma schema path has no flat key: @askdb/prisma reads `prismaSchemaPath`.
  setFlat(flat, "ASKDB_INTROSPECT_OUT", resolved.outputDir);
  setFlat(flat, "ASKDB_INTROSPECT_SCHEMAS", resolved.schemas?.join(","));
  return resolved;
}

/**
 * The typed `ai` sections, for `@askdb/ai`'s `*FromSection` methods. The flat map carries no AI
 * keys: `@askdb/ai`'s adapters map a section's settings to a provider, so no copy of that mapping
 * lives here.
 */
function resolveAi(ai: NormalizedAskDbConfig["ai"]): ResolvedAskDbConfig["ai"] {
  const { language, embedding } = ai;
  return {
    language: {
      provider: language.provider,
      connection: { ...language.connection },
      model: language.model,
      modelFamily: language.modelFamily,
      reasoning: language.reasoning,
    },
    embedding: embedding
      ? {
          provider: embedding.provider,
          connection: { ...embedding.connection },
          model: embedding.model,
          dimensions: embedding.dimensions,
        }
      : undefined,
  };
}

function resolveRag(rag: NormalizedAskDbConfig["rag"], ai: ResolvedAskDbConfig["ai"], flat: FlatMap): AskDbRuntimeRagConfig {
  const { store, storeConfig } = rag;
  const embedding = ai.embedding;
  setFlat(flat, "ASKDB_RAG_EMBEDDER", embedding ? "ai" : "mock");
  if (embedding) {
    setFlat(flat, "ASKDB_RAG_EMBEDDER_MODEL", embedding.model);
    setFlat(flat, "ASKDB_RAG_EMBEDDER_DIMENSIONS", embedding.dimensions);
  }

  if (!isMember(store, ASKDB_RAG_STORES)) {
    throw new Error(`askdb.config: invalid rag.store ${describeValue(store)} (expected one of: ${ASKDB_RAG_STORES.join(", ")}).`);
  }
  if (store === "file") {
    if (!storeConfig.file) throw new Error('askdb.config: rag.store is "file" but `rag.storeConfig.file` is missing.');
    // Unset, the CLI and Studio use `<schema dir>/schema`.
    setFlat(flat, "ASKDB_RAG_FILE_BASE_PATH", readString(storeConfig.file.basePath, "rag.storeConfig.file.basePath"));
  } else if (store === "pgvector") {
    const pgvector = storeConfig.pgvector;
    if (!pgvector) throw new Error('askdb.config: rag.store is "pgvector" but `rag.storeConfig.pgvector` is missing.');
    const url = readString(pgvector.databaseUrl, "rag.storeConfig.pgvector.databaseUrl");
    if (!url) {
      throw new Error(
        'askdb.config: rag.store is "pgvector" but `rag.storeConfig.pgvector.databaseUrl` is missing; set it, for example `databaseUrl: env("PGVECTOR_URL")`.',
      );
    }
    setFlat(flat, "ASKDB_PGVECTOR_URL", url);
    // The mock embedder's vectors are always 64 wide. With `ai.embedding`, the dimensions written
    // above are only a size to request: unset, the model's own width applies, learned at index time.
    if (!embedding) setFlat(flat, "ASKDB_RAG_EMBEDDER_DIMENSIONS", DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS);
    setFlat(flat, "ASKDB_PGVECTOR_INDEX_STRATEGY", pgvectorIndexStrategy(pgvector.indexStrategy));
  }

  // The RAG CLI's OpenAI embedder never reads another provider's key or base URL: it uses the
  // embedding connection when that is OpenAI's, else only the OpenAI language connection.
  const openaiEmbedding = embedding?.provider === "openai" ? embedding : undefined;
  const source = openaiEmbedding ?? (ai.language.provider === "openai" ? ai.language : undefined);
  return {
    embedder: {
      apiKey: source?.connection.apiKey,
      baseURL: source?.connection.baseUrl,
      model: openaiEmbedding?.model,
    },
    store,
    storeConfig,
  };
}

function resolveLogging(logging: AskDbConfig["logging"], flat: FlatMap): AskDbRuntimeLoggingConfig {
  const resolved: AskDbRuntimeLoggingConfig = {
    level: readMember(logging?.level, ASKDB_LOG_LEVELS, "logging.level"),
    correlationId: readString(logging?.correlationId, "logging.correlationId"),
    logFile: readString(logging?.logFile, "logging.logFile"),
    logStdout: readBoolean(logging?.logStdout, "logging.logStdout") ?? false,
  };
  setFlat(flat, "ASKDB_LOG_LEVEL", resolved.level);
  setFlat(flat, "ASKDB_CORRELATION_ID", resolved.correlationId);
  setFlat(flat, "ASKDB_LOG_FILE", resolved.logFile);
  if (resolved.logStdout) setFlat(flat, "ASKDB_LOG_STDOUT", "true");
  return resolved;
}

function resolveModes(modes: AskDbConfig["modes"], flat: FlatMap): AskDbRuntimeModesConfig {
  const resolved: AskDbRuntimeModesConfig = {
    askdbMode: readMember(modes?.askdbMode, ASKDB_MODES_V1, "modes.askdbMode"),
    omitSensitiveFromPrompt: readBoolean(modes?.omitSensitiveFromPrompt, "modes.omitSensitiveFromPrompt") ?? false,
  };
  setFlat(flat, "ASKDB_MODE", resolved.askdbMode);
  if (resolved.omitSensitiveFromPrompt) setFlat(flat, "ASKDB_OMIT_SENSITIVE_FROM_PROMPT", "true");
  return resolved;
}

/** `host` has no runtime section: `createAskDb` reads `structured.host`. It's checked here all the same. */
function resolveHost(host: AskDbConfig["host"], flat: FlatMap): void {
  setFlat(flat, "ASKDB_SCHEMA_PATH", readString(host?.schemaPath, "host.schemaPath"));
  setFlat(flat, "ASKDB_SCHEMA_JSON", readString(host?.schemaJson, "host.schemaJson"));
}

function resolveHttpApi(httpApi: AskDbConfig["httpApi"], flat: FlatMap): AskDbRuntimeHttpApiConfig {
  const port = readListenPort(httpApi?.listen?.port, "httpApi.listen.port");
  const host = readString(httpApi?.listen?.host, "httpApi.listen.host");
  const allowSchemaOverride = readBoolean(httpApi?.allowSchemaOverride, "httpApi.allowSchemaOverride") ?? false;
  const requestTimeoutMs = readRequestTimeoutMs(httpApi?.requestTimeoutMs, "httpApi.requestTimeoutMs");
  setFlat(flat, "PORT", port);
  setFlat(flat, "HOST", host);
  if (allowSchemaOverride) setFlat(flat, "ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE", "true");
  setFlat(flat, "ASKDB_HTTP_REQUEST_TIMEOUT_MS", requestTimeoutMs);
  return {
    listen: { port: port ?? DEFAULT_HTTP_API_PORT, host: host ?? DEFAULT_HTTP_API_HOST },
    allowSchemaOverride,
    requestTimeoutMs: requestTimeoutMs ?? DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS,
  };
}

/** The introspection connection for `provider`, when introspection uses that engine. */
function introspectionConnectionFor(
  provider: AskDbStudioExecuteProvider,
  introspection: AskDbRuntimeIntrospectionConfig,
): string | undefined {
  switch (provider) {
    case "postgres":
      return introspection.postgresDatabaseUrl;
    case "mysql":
      return introspection.mysqlDatabaseUrl;
    case "sqlserver":
      return introspection.sqlserverDatabaseUrl;
    case "sqlite":
      return introspection.sqliteFile;
  }
}

function resolveStudio(
  studio: AskDbConfig["studio"],
  introspection: AskDbRuntimeIntrospectionConfig,
  flat: FlatMap,
): AskDbRuntimeStudioConfig {
  // `listen` has no runtime section: Studio reads `structured.studio.listen` and checks the port
  // when it starts, so only the host's type is checked here.
  const listen = studio?.listen;
  setFlat(flat, "ASKDB_STUDIO_HOST", readString(listen?.host, "studio.listen.host"));
  if (listen?.port !== undefined && !Number.isNaN(listen.port)) setFlat(flat, "ASKDB_STUDIO_PORT", listen.port);

  const execute = studio?.execute;
  // An explicit provider, else the introspection provider when it's a live engine, else postgres.
  // An unknown provider falls back the same way.
  const configured = readString(execute?.provider, "studio.execute.provider");
  const provider: AskDbStudioExecuteProvider = isMember(configured, ASKDB_STUDIO_EXECUTE_PROVIDERS)
    ? configured
    : isMember(introspection.provider, ASKDB_STUDIO_EXECUTE_PROVIDERS)
      ? introspection.provider
      : "postgres";
  const enabled = readBoolean(execute?.enabled, "studio.execute.enabled");
  const useIntrospectionConnection = readBoolean(
    execute?.useIntrospectionConnection,
    "studio.execute.useIntrospectionConnection",
  );
  const timeoutMs = readPositiveInteger(execute?.timeoutMs, "studio.execute.timeoutMs");
  const maxRows = readPositiveInteger(execute?.maxRows, "studio.execute.maxRows");
  const configuredUrl = readString(execute?.databaseUrl, "studio.execute.databaseUrl");
  const configuredFile = readString(execute?.file, "studio.execute.file");

  if (configured !== undefined) setFlat(flat, "ASKDB_STUDIO_EXECUTE_PROVIDER", provider);
  setFlat(flat, "ASKDB_STUDIO_DATABASE_URL", configuredUrl);
  setFlat(flat, "ASKDB_STUDIO_SQLITE_FILE", configuredFile);
  if (enabled !== undefined) setFlat(flat, "ASKDB_STUDIO_EXECUTE_ENABLED", String(enabled));
  if (useIntrospectionConnection !== undefined) {
    setFlat(flat, "ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION", String(useIntrospectionConnection));
  }
  setFlat(flat, "ASKDB_STUDIO_EXECUTE_TIMEOUT_MS", timeoutMs);
  setFlat(flat, "ASKDB_STUDIO_EXECUTE_MAX_ROWS", maxRows);

  // The introspection connection is reused only when `useIntrospectionConnection` is on, so
  // turning execute on never runs ad-hoc SQL with introspection credentials by accident.
  const explicit = provider === "sqlite" ? configuredFile : configuredUrl;
  const introspectionConnection = introspectionConnectionFor(provider, introspection);
  const connection = explicit ?? (useIntrospectionConnection ? introspectionConnection : undefined);
  return {
    execute: {
      provider,
      databaseUrl: provider === "sqlite" ? undefined : connection,
      file: provider === "sqlite" ? connection : undefined,
      enabled: enabled ?? false,
      useIntrospectionConnection: useIntrospectionConnection ?? false,
      introspectionConnectionAvailable:
        explicit === undefined && !useIntrospectionConnection && introspectionConnection !== undefined,
      timeoutMs: timeoutMs ?? DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS,
      maxRows: maxRows ?? DEFAULT_STUDIO_EXECUTE_MAX_ROWS,
    },
  };
}

/** What {@link resolveAskDbConfig} returns. */
export type AskDbConfigResolution = {
  resolved: ResolvedAskDbConfig;
  /** The flat map: each setting's canonical env key, written in the same pass that checks it. */
  flat: Record<string, string>;
  /** One message per deprecated key in use. No key is deprecated today; the list stays for the next one. */
  deprecations: string[];
};

/**
 * Resolves every setting of an authored config: checks it, fills in defaults, and writes its flat
 * key. Pure: it reads no environment. Throws `askdb.config: …` errors that name the config key for
 * a config that can't load, a removed key included (the loader adds the file name).
 */
export function resolveAskDbConfig(config: AskDbConfig): AskDbConfigResolution {
  const normalized = normalizeAskDbConfig(config);
  const deprecations: string[] = [];
  const flat: FlatMap = {};
  const ai = resolveAi(normalized.ai);
  const introspection = resolveIntrospection(config.introspection, flat);
  const rag = resolveRag(normalized.rag, ai, flat);
  const logging = resolveLogging(config.logging, flat);
  const modes = resolveModes(config.modes, flat);
  resolveHost(config.host, flat);
  const dev = { mockSql: readString(config.dev?.mockSql, "dev.mockSql") };
  setFlat(flat, "ASKDB_MOCK_SQL", dev.mockSql);
  const studio = resolveStudio(config.studio, introspection, flat);
  const httpApi = resolveHttpApi(config.httpApi, flat);
  return {
    resolved: {
      ai,
      introspection,
      rag,
      logging,
      httpApi,
      dev,
      modes,
      // Passed through as written: loading doesn't check it.
      nlToSql: { dialect: config.dialect },
      studio,
    },
    flat,
    deprecations,
  };
}
