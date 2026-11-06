import type { EmbeddingModel, LanguageModel } from "ai";
import type { AiReasoningSection, ReasoningSettings } from "./reasoning.js";
import { refuseBaseUrlCredentials, type AiBaseUrlCredentialsError } from "./base-url.js";

/*
 * AskDB is BYO-LanguageModel at the function level (see `ask()`), but the
 * bundled apps (CLI, HTTP API, Studio) all need to construct one from
 * environment variables. This module owns the adapter contract and the
 * universal AskDB precedence rules; each provider adapter (built in under
 * `./providers/`, or supplied by the host) owns its native env vars, aliases,
 * defaults, and connection options.
 */

/** An `ASKDB_AI_PROVIDER` / `ai.provider` value: a provider name or one of its aliases. */
export type AiProvider = string;

export type AiConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Provider-specific connection settings, interpreted only by the owning adapter. */
  providerOptions?: Record<string, unknown>;
};

export type AiEnv = Record<string, string | undefined>;

export type AiUsage = "language" | "embedding";

export type ResolveConfigOptions = {
  usage: AiUsage;
  /** Default model when no env override is set. */
  modelDefault?: string;
  /** Per-app embedding model env var, read before `ASKDB_AI_EMBEDDING_MODEL`. Embedding usage only. */
  modelEnvVar?: string;
};

/**
 * A provider connection's settings, as an `askdb.config` connection holds them
 * (`getAskDbRuntimeConfig().ai.language.connection`). A blank setting counts as unset.
 */
export type AiConnectionSection = {
  apiKey?: string;
  /** Used when `apiKey` is unset, for example while a key rotates. */
  apiKeySecondary?: string;
  baseUrl?: string;
  /** Azure / Foundry: the subdomain of `https://<resourceName>.openai.azure.com`. Ignored by other providers. */
  resourceName?: string;
  /** Azure / Foundry API version. Ignored by other providers. */
  apiVersion?: string;
};

/**
 * The language model's settings: `getAskDbRuntimeConfig().ai.language` from `@askdb/config`, or
 * one a host builds itself. `provider` is a registered provider name or alias.
 */
export type AiLanguageSection = {
  provider: string;
  connection: AiConnectionSection;
  /** Unset: the provider's default language model. On Azure, the deployment name. */
  model?: string;
  /** Azure / Foundry: the model behind a deployment name, for reasoning support (e.g. `"gpt-5"`). */
  modelFamily?: string;
  reasoning?: AiReasoningSection;
};

/**
 * The embedding model's settings: `getAskDbRuntimeConfig().ai.embedding` from `@askdb/config`,
 * or one a host builds itself. The model is required: no layer picks an embedding model.
 */
export type AiEmbeddingSection = {
  provider: string;
  connection: AiConnectionSection;
  model?: string;
  /** The vector size to request; unset leaves it to the model. */
  dimensions?: number;
};

/** What an adapter's `resolveConfigFromSection` reads from either section. */
export type AiModelSection = {
  provider: string;
  connection: AiConnectionSection;
  model?: string;
  modelFamily?: string;
};

/** The setting a credentialed section base URL is reported as (see {@link AiBaseUrlCredentialsError}). */
const SECTION_BASE_URL_SETTING = "connection.baseUrl";

/** Declarative description of one provider's native env vars, consumed by `resolveBaseConfig`. */
export type ProviderEnvSpec = {
  apiKeyVars: readonly string[];
  apiKeySecondaryVars?: readonly string[];
  modelVars?: readonly string[];
  embeddingModelVars?: readonly string[];
  baseURLVars?: readonly string[];
  /** The language model when no variable sets one. Embedding models have none: an index bakes its model in. */
  defaultModel?: string;
};

/**
 * Resolves the provider-neutral parts of an AI config from environment
 * variables. Returns `undefined` if no API key is configured (callers treat
 * this as "AI is disabled" rather than erroring, so AI features can be
 * optional).
 *
 * BYO-key design: each provider has its native env vars (for example
 * `OPENAI_API_KEY` for OpenAI). The `ASKDB_AI_*` family is a universal alias
 * set that works across providers, useful when a deployment wants one set of
 * names regardless of the selected provider.
 *
 * Precedence for the API key (within the selected provider):
 *   1. `ASKDB_AI_API_KEY`               - universal alias (primary)
 *   2. provider-native primary
 *   3. provider-native secondary
 *   4. `ASKDB_AI_API_KEY_SECONDARY`     - universal rotation fallback
 *
 * Precedence for language models:
 *   1. `ASKDB_AI_MODEL`
 *   2. `ASKDB_MODEL`
 *   3. provider-native language model vars
 *   4. `options.modelDefault`
 *   5. provider default language model
 *
 * Precedence for embedding models:
 *   1. `env[options.modelEnvVar]`
 *   2. `ASKDB_AI_EMBEDDING_MODEL`
 *   3. `ASKDB_EMBEDDING_MODEL`
 *   4. provider-native embedding model vars
 *   5. `options.modelDefault`
 *
 * No provider has a default embedding model, so with a key and none of these set it throws.
 *
 * Precedence for base URLs:
 *   1. `ASKDB_AI_BASE_URL`
 *   2. provider-native base URL vars
 *
 * A base URL with a username or password throws {@link AiBaseUrlCredentialsError}, naming the
 * variable it came from: `fetch` would refuse it and quote the whole URL in its error.
 *
 * **Important:** these settings come only from the map the host passes, never from `process.env`
 * (whose one read in `@askdb/ai` is `baseURLOption`'s credential check, ADR 0036). A host
 * with an `askdb.config` file passes its typed section to the registry's `*FromSection` methods
 * instead; the env map is for hosts without one.
 */
export function resolveBaseConfig(
  provider: string,
  env: AiEnv,
  spec: ProviderEnvSpec,
  options: ResolveConfigOptions,
): AiConfig | undefined {
  // The universal key is read on its own, before `spec` is touched, so it still
  // resolves for an untyped custom spec with no `apiKeyVars`.
  const apiKey =
    first(env, ["ASKDB_AI_API_KEY"]) ||
    first(env, [
      ...spec.apiKeyVars,
      ...(spec.apiKeySecondaryVars ?? []),
      "ASKDB_AI_API_KEY_SECONDARY",
    ]);
  if (!apiKey) return undefined;

  const baseURLVar = firstSet(env, ["ASKDB_AI_BASE_URL", ...(spec.baseURLVars ?? [])]);
  refuseBaseUrlCredentials(baseURLVar?.value, baseURLVar?.name ?? "");
  const baseURL = baseURLVar?.value;
  const model = resolveModel(provider, env, spec, options);

  return {
    provider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
  };
}

/**
 * Resolves the provider-neutral parts of an AI config from a section's typed settings, the
 * section counterpart of {@link resolveBaseConfig}. Returns `undefined` when the connection has no
 * API key ("AI is disabled").
 *
 * - **API key:** `connection.apiKey`, else `connection.apiKeySecondary`.
 * - **Model:** `section.model`. A language section without one gets `spec.defaultModel`; an
 *   embedding section without one throws, since no layer picks an embedding model (ADR 0016).
 * - **Base URL:** `connection.baseUrl`. One with a user name or password throws
 *   {@link AiBaseUrlCredentialsError} naming `connection.baseUrl`, key or no key.
 *
 * Every setting is trimmed, and a blank one counts as unset.
 */
export function resolveBaseConfigFromSection(
  provider: string,
  section: AiModelSection,
  spec: ProviderEnvSpec,
  options: { usage: AiUsage },
): AiConfig | undefined {
  const { connection } = section;
  const baseURL = nonBlank(connection.baseUrl);
  refuseBaseUrlCredentials(baseURL, SECTION_BASE_URL_SETTING);
  const apiKey = nonBlank(connection.apiKey) ?? nonBlank(connection.apiKeySecondary);
  if (!apiKey) return undefined;

  const model = nonBlank(section.model) ?? (options.usage === "language" ? spec.defaultModel : undefined);
  if (!model) throw sectionWithoutModel(provider, options.usage);
  return {
    provider,
    apiKey,
    model,
    ...(baseURL ? { baseURL } : {}),
  };
}

/**
 * Refuses a section's credentialed `connection.baseUrl` before any adapter reads it, so a custom
 * adapter resolving from the universal env keys reports the section's setting, not an env name.
 */
export function refuseSectionBaseUrlCredentials(section: AiModelSection): void {
  refuseBaseUrlCredentials(nonBlank(section.connection.baseUrl), SECTION_BASE_URL_SETTING);
}

function sectionWithoutModel(provider: string, usage: AiUsage): Error {
  return new Error(
    usage === "embedding"
      ? `${provider}: no embedding model configured. Set ai.embedding.model in askdb.config.*.`
      : `${provider}: no language model configured. Set ai.language.model in askdb.config.*.`,
  );
}

/**
 * Throws when an embedding section has an API key but no model, whatever its adapter: no layer
 * picks an embedding model (ADR 0016), so a custom adapter's own default doesn't either.
 */
export function refuseSectionWithoutEmbeddingModel(section: AiModelSection): void {
  const { connection } = section;
  const hasKey = (nonBlank(connection.apiKey) ?? nonBlank(connection.apiKeySecondary)) !== undefined;
  if (hasKey && nonBlank(section.model) === undefined) throw sectionWithoutModel(section.provider, "embedding");
}

/** A string trimmed, or `undefined` when it's unset or blank. */
export function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveModel(
  provider: string,
  env: AiEnv,
  spec: ProviderEnvSpec,
  options: ResolveConfigOptions,
): string {
  let model: string | undefined;
  if (options.usage === "embedding") {
    model =
      first(env, [
        ...(options.modelEnvVar ? [options.modelEnvVar] : []),
        "ASKDB_AI_EMBEDDING_MODEL",
        "ASKDB_EMBEDDING_MODEL",
        ...(spec.embeddingModelVars ?? []),
      ]) || options.modelDefault;
  } else {
    model =
      first(env, ["ASKDB_AI_MODEL", "ASKDB_MODEL", ...(spec.modelVars ?? [])]) ||
      options.modelDefault ||
      spec.defaultModel;
  }

  if (!model) {
    throw new Error(
      options.usage === "embedding"
        ? `${provider}: no embedding model configured. Set ai.embedding.model in askdb.config.* (or ASKDB_AI_EMBEDDING_MODEL).`
        : `${provider}: no language model configured. Set ASKDB_AI_MODEL (or the provider's native model variable).`,
    );
  }
  return model;
}

/** Provider names and aliases match case-insensitively, ignoring surrounding whitespace. */
export function normalizeProvider(provider: string): string {
  return provider.toLowerCase().trim();
}

function first(env: AiEnv, vars: readonly string[]): string | undefined {
  return firstSet(env, vars)?.value;
}

/** The first of `vars` set to a non-blank value in `env`, with its name. */
function firstSet(env: AiEnv, vars: readonly string[]): { name: string; value: string } | undefined {
  for (const name of vars) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

export type CreateEmbeddingModelOptions = {
  /** Optional dimensionality override for providers that support it. */
  dimensions?: number;
  /** Optional end-user id forwarded to providers that support it. */
  user?: string;
};

export type AiProviderAdapter = {
  provider: string;
  /** Additional ASKDB_AI_PROVIDER values that select this adapter. */
  aliases?: readonly string[];
  /**
   * Short human-readable setup hint shown when no API key is configured.
   * Used by {@link AiRegistry.keyMissingMessage} to build a composite message.
   * Example: "For OpenAI, set OPENAI_API_KEY (or ASKDB_AI_API_KEY)."
   */
  configHint?: string;
  /** Resolve an AiConfig from env. Return undefined when no API key is configured ("AI disabled"). */
  resolveConfig(env: AiEnv, options: ResolveConfigOptions): AiConfig | undefined;
  /**
   * Resolve an AiConfig from a section's typed settings, the way `resolveConfig` reads env. Return
   * undefined when the connection has no API key. Every built-in provider implements it. An
   * adapter without it gets the section through the universal env keys instead
   * (`ASKDB_AI_API_KEY`, `ASKDB_AI_API_KEY_SECONDARY`, `ASKDB_AI_BASE_URL`, and `ASKDB_AI_MODEL`
   * or `ASKDB_AI_EMBEDDING_MODEL`), passed to `resolveConfig`.
   */
  resolveConfigFromSection?(section: AiModelSection, options: { usage: AiUsage }): AiConfig | undefined;
  createLanguageModel(config: AiConfig): Promise<LanguageModel> | LanguageModel;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel> | EmbeddingModel;
  /**
   * Maps a provider-neutral {@link ReasoningSettings} to this provider's
   * native `generateText` `providerOptions` shape (e.g. OpenAI
   * `reasoningEffort`, Google `thinkingConfig`, Anthropic `thinking`).
   *
   * Returns `undefined` when `reasoningEffort` is unset **or** when
   * `config.model` doesn't support reasoning tuning — callers must not send
   * provider options to models that don't understand them. Adapters that
   * don't implement this (or don't have a reasoning knob) simply omit it.
   */
  resolveProviderOptions?(
    config: AiConfig,
    settings: ReasoningSettings,
  ): Record<string, unknown> | undefined;
};

/**
 * One entry passed to `createAiRegistry()`: either the name (or alias) of a
 * provider built into `@askdb/ai` (e.g. `"openai"`, `"foundry"`), or an
 * {@link AiProviderAdapter} object for a custom / third-party provider.
 */
export type AiProviderSelector = AiProvider | AiProviderAdapter;

/**
 * What `createAiRegistry()` accepts: a list of built-in provider names and/or
 * adapter objects, or a record keyed by provider name. Omit it entirely to
 * register every built-in provider.
 */
export type AiProviderAdapters =
  | readonly AiProviderSelector[]
  | Partial<Record<AiProvider, AiProviderAdapter>>;

export type AiRegistry = {
  hasProvider(provider: AiProvider): boolean;
  resolveAiConfig(
    env: AiEnv,
    options?: { modelDefault?: string },
  ): AiConfig | undefined;
  resolveEmbeddingConfig(
    env: AiEnv,
    options?: { modelDefault?: string; modelEnvVar?: string },
  ): AiConfig | undefined;
  createLanguageModel(config: AiConfig): Promise<LanguageModel>;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel>;
  createLanguageModelFromEnv(
    env: AiEnv,
    options?: { modelDefault?: string },
  ): Promise<LanguageModel | undefined>;
  createEmbeddingModelFromEnv(
    env: AiEnv,
    options?: { modelDefault?: string; modelEnvVar?: string } & CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel | undefined>;
  /**
   * Resolves the language model's config from a typed section, such as
   * `getAskDbRuntimeConfig().ai.language` from `@askdb/config`. Returns `undefined` when the
   * connection has no API key. Throws for a provider the registry doesn't have, and
   * {@link AiBaseUrlCredentialsError} for a `connection.baseUrl` with a user name or password.
   */
  resolveAiConfigFromSection(section: AiLanguageSection): AiConfig | undefined;
  /**
   * Resolves the embedding model's config from a typed section, such as
   * `getAskDbRuntimeConfig().ai.embedding`. Throws when the section has a key but no model.
   * Otherwise as {@link AiRegistry.resolveAiConfigFromSection}.
   */
  resolveEmbeddingConfigFromSection(section: AiEmbeddingSection): AiConfig | undefined;
  /** {@link AiRegistry.resolveAiConfigFromSection}, then builds the model; `undefined` without a key. */
  createLanguageModelFromSection(section: AiLanguageSection): Promise<LanguageModel | undefined>;
  /**
   * {@link AiRegistry.resolveEmbeddingConfigFromSection}, then builds the model, asking for
   * `section.dimensions` unless `options.dimensions` is set; `undefined` without a key.
   */
  createEmbeddingModelFromSection(
    section: AiEmbeddingSection,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel | undefined>;
  /**
   * Maps a provider-neutral {@link ReasoningSettings} (e.g. `{ reasoningEffort: "low" }`)
   * to the `providerOptions` bag for `config.provider`'s `generateText` calls.
   * Delegates to the resolved adapter's `resolveProviderOptions`; returns
   * `undefined` when the adapter doesn't implement it, `reasoningEffort` is
   * unset, or `config.model` doesn't support reasoning tuning.
   *
   * Pass the result to `ask({ deps: { providerOptions } })` in `@askdb/core`.
   */
  resolveProviderOptions(
    config: AiConfig,
    settings: ReasoningSettings,
  ): Record<string, unknown> | undefined;
  /**
   * Human-readable message describing how to configure AI for this registry.
   * Assembles configHint values from registered adapters (deduplicated, stable
   * registration order). Falls back to the static {@link aiKeyMissingMessage}
   * body when no adapter has a configHint.
   */
  keyMissingMessage(context: string): string;
};
