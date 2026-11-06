import {
  createAiRegistry,
  resolveReasoningEffort,
  type AiConfig,
  type AiProviderAdapters,
  type AiRegistry,
  type ReasoningEffort,
} from "@askdb/ai";
import type { AskDbRuntimeConfig } from "@askdb/config";
import {
  ask,
  bindPreparedQuery,
  expandTenantScope,
  isBuiltInDialectId,
  loadSchema,
  loadSchemaFromJson,
  parseAskDbModeV1,
  SUPPORTED_DIALECT_IDS,
  type AnyNormalizedSchema,
  type AskDbLanguageModel,
  type AskDbModeV1,
  type AskDialectInput,
  type AskGenerateDeps,
  type AskPipelineOptions,
  type AskPipelineResult,
  type BindGuardrails,
  type BuiltInDialectId,
  type BoundQuery,
  type PreparedQuery,
  type QueryParameterValue,
  type ResolveTenantDescendants,
} from "@askdb/core";
import {
  DialectNotSupportedError,
  ModelNotConfiguredError,
  SchemaLoadError,
  SchemaNotConfiguredError,
} from "./errors.js";

/** Where a schema comes from. A pre-loaded object short-circuits loading. */
export type SchemaSource =
  | { path: string }
  | { json: string }
  | { schema: AnyNormalizedSchema };

/**
 * Per-call options. Everything is optional; anything set overrides the client default,
 * except the two config `modes` settings, which a call can only tighten.
 */
export type AskOverrides = Omit<
  AskPipelineOptions,
  "question" | "schema" | "model" | "dialect" | "mode"
> & {
  /**
   * Trust boundary for this call. Config `modes.askdbMode` (unset: `"schema_only"`) is the
   * loosest mode a call gets: `"schema_only"` tightens it, `"bounded_results"` can't loosen it.
   */
  mode?: AskDbModeV1;
  schema?: SchemaSource | AnyNormalizedSchema;
  model?: AskDbLanguageModel;
  dialect?: AskDialectInput;
  /**
   * Provider-portable reasoning/latency effort for this call, overriding the
   * client default and `askdb.config.ts`'s `ai.reasoning.nlToSql`/`effort`.
   * Ignored when `model` or `deps.generateText` is also set (BYO paths).
   */
  reasoningEffort?: ReasoningEffort;
};

/** Options for {@link AskDbClient.bind}. Everything is optional; `schema` overrides the client's schema. */
export type BindOptions = Omit<BindGuardrails, "schema"> & {
  /** The schema to check the template under. Defaults to the schema `ask()` resolves. */
  schema?: SchemaSource | AnyNormalizedSchema;
  /** Expands a `subtree` `tenantScope` before binding, as in `ask()`. */
  resolveTenantDescendants?: ResolveTenantDescendants;
};

export type DialectResolution = {
  dialect: AskDialectInput;
  source: "override" | "config" | "schema" | "default";
  /** Set when config.dialect and schema.provider disagree (config wins). */
  note?: string;
};

export type CreateAskDbOptions = {
  /** Runtime snapshot, e.g. from `getAskDbRuntimeConfig()`. */
  config: AskDbRuntimeConfig;
  /**
   * Which AI providers the client can build models for. Optional: when neither
   * `providers` nor `registry` is passed, every provider built into `@askdb/ai`
   * is registered and `ai.provider` in your config picks one — install the
   * matching SDK (e.g. `@ai-sdk/openai`), which is loaded on first use.
   *
   * Pass built-in names to restrict the set (`providers: ["openai"]`), or
   * `AiProviderAdapter` objects for custom providers (mixable with names).
   * Pass at most one of `providers` or `registry`.
   */
  providers?: AiProviderAdapters;
  /**
   * Prebuilt AI registry from `createAiRegistry(...)` — advanced alternative
   * to `providers`, e.g. to share one registry across several clients.
   */
  registry?: AiRegistry;
  /** Default schema source. Falls back to config `host.schemaJson`/`host.schemaPath`/env. */
  schema?: SchemaSource;
  /** Default dialect override. Falls back to config.dialect → schema.provider → "postgres". */
  dialect?: BuiltInDialectId;
  /**
   * What to do when `schema.provider` is not a built-in dialect id and no
   * config/override dialect is set.
   */
  unknownDialect?: "throw" | "fallback-postgres";
  /** Optional hook fired on each ask with how schema/model/dialect resolved (host logging/UX). */
  onResolve?: (info: { dialect: DialectResolution; modelSource: "override" | "registry" | "mock" }) => void;
  /**
   * Client-level default reasoning/latency effort for NL→SQL generation
   * (`ask()`). When set, takes precedence over `askdb.config.ts`'s
   * `ai.reasoning.nlToSql`/`effort` env resolution; overridden per-call by
   * `AskOverrides.reasoningEffort`.
   */
  reasoningEffort?: ReasoningEffort;
};

export type AskDbClient = {
  ask(question: string, overrides?: AskOverrides): Promise<AskPipelineResult>;
  /**
   * Rebind a stored `preparedQuery` with new values, without calling the model. Checks the
   * template under the client's schema (the one `ask()` resolves, unless `options.schema`
   * is set), the given tenant scope and modes, expands a `subtree` scope with
   * `options.resolveTenantDescendants`, and forwards to `@askdb/core`'s `bindPreparedQuery()`.
   */
  bind(
    prepared: PreparedQuery,
    values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
    options?: BindOptions,
  ): Promise<BoundQuery>;
  /** Drop cached schema + model so the next ask() re-resolves them. */
  reload(): void;
};

function resolveRegistry(options: CreateAskDbOptions): AiRegistry {
  if (options.registry && options.providers) {
    throw new Error("createAskDb: pass either `providers` or `registry`, not both.");
  }
  if (options.registry) return options.registry;
  // No providers/registry: register every built-in provider (each loads its
  // @ai-sdk/* package lazily), so `createAskDb({ config })` is enough.
  return createAiRegistry(options.providers);
}

export function createAskDb(options: CreateAskDbOptions): AskDbClient {
  const { config } = options;
  const registry = resolveRegistry(options);
  let cachedSchema: AnyNormalizedSchema | undefined;
  let cachedModel: AskDbLanguageModel | undefined;
  let cachedAiConfig: AiConfig | undefined;

  function schemaSourceLabel(src: SchemaSource): string {
    if ("schema" in src) return "schema";
    if ("json" in src) return "json";
    return `path (${src.path})`;
  }

  function loadFromSource(src: SchemaSource | AnyNormalizedSchema, label: string): AnyNormalizedSchema {
    // A normalized schema, v1 or v2, passed as is: every one has `tables`, no SchemaSource does.
    if ("tables" in src) return src;
    if ("schema" in src) return src.schema;
    try {
      if ("json" in src) return loadSchemaFromJson(src.json);
      return loadSchema(src.path);
    } catch (e) {
      throw new SchemaLoadError(label, e);
    }
  }

  function resolveDefaultSchema(): AnyNormalizedSchema {
    if (cachedSchema) return cachedSchema;
    if (options.schema) {
      cachedSchema = loadFromSource(options.schema, schemaSourceLabel(options.schema));
      return cachedSchema;
    }
    const host = config.structured.host;
    const env = config.ai.aiEnv;
    const json = host?.schemaJson?.trim() || env["ASKDB_SCHEMA_JSON"]?.trim();
    if (json) {
      cachedSchema = loadFromSource(
        { json },
        host?.schemaJson?.trim() ? "host.schemaJson" : "ASKDB_SCHEMA_JSON",
      );
      return cachedSchema;
    }
    const path = host?.schemaPath?.trim() || env["ASKDB_SCHEMA_PATH"]?.trim();
    if (path) {
      cachedSchema = loadFromSource(
        { path },
        host?.schemaPath?.trim() ? `host.schemaPath (${path})` : `ASKDB_SCHEMA_PATH (${path})`,
      );
      return cachedSchema;
    }
    throw new SchemaNotConfiguredError(
      "No schema configured. Pass `schema` to createAskDb() or per-call, or set host.schemaPath / host.schemaJson in askdb.config.*.",
    );
  }

  function schemaProviderOf(schema: AnyNormalizedSchema): string | undefined {
    return "provider" in schema && typeof schema.provider === "string" ? schema.provider : undefined;
  }

  function resolveDialect(schema: AnyNormalizedSchema, override?: AskDialectInput): DialectResolution {
    if (override) return { dialect: override, source: "override" };
    const configDialect = options.dialect ?? config.nlToSql.dialect;
    const provider = schemaProviderOf(schema);
    if (configDialect) {
      if (provider && provider !== configDialect) {
        return {
          dialect: configDialect,
          source: "config",
          note: `Using config dialect '${configDialect}'; schema declared provider '${provider}'.`,
        };
      }
      return { dialect: configDialect, source: "config" };
    }
    if (provider) {
      if (!isBuiltInDialectId(provider)) {
        if (options.unknownDialect === "fallback-postgres") {
          return {
            dialect: "postgres",
            source: "default",
            note: `Schema declared provider '${provider}' with no shipped DialectSpec; defaulting to 'postgres'.`,
          };
        }
        throw new DialectNotSupportedError(
          provider,
          `Schema declares provider '${provider}', but AskDB does not yet ship a DialectSpec for it.\n` +
            `Hint: set \`dialect: "postgres"\` (or another supported id) in askdb.config.* to override. ` +
            `Supported: ${SUPPORTED_DIALECT_IDS.join(", ")}.`,
        );
      }
      return { dialect: provider, source: "schema" };
    }
    return { dialect: "postgres", source: "default" };
  }

  type ResolvedModel = {
    model: AskDbLanguageModel;
    source: "override" | "registry" | "mock";
    /** Mock-path deps (`generateText`) — passed through verbatim, bypasses reasoning resolution. */
    mockDeps?: AskGenerateDeps;
    /** Computed from `reasoningEffort` resolution — registry path only. */
    providerOptions?: Record<string, unknown>;
  };

  async function resolveModel(
    override: AskDbLanguageModel | undefined,
    deps: AskGenerateDeps | undefined,
    reasoningEffortOverride: ReasoningEffort | undefined,
  ): Promise<ResolvedModel> {
    if (override) return { model: override, source: "override" };
    if (deps?.generateText) {
      return { model: undefined as unknown as AskDbLanguageModel, source: "mock", mockDeps: deps };
    }
    const mockSql = config.dev.mockSql;
    if (mockSql !== undefined) {
      return {
        model: undefined as unknown as AskDbLanguageModel,
        source: "mock",
        mockDeps: { generateText: (async () => ({ text: mockSql } as any)) as any },
      };
    }
    if (!cachedAiConfig) {
      cachedAiConfig = registry.resolveAiConfig(config.ai.aiEnv);
      if (!cachedAiConfig) throw new ModelNotConfiguredError(registry.keyMissingMessage("NL→SQL generation"));
    }
    if (!cachedModel) {
      cachedModel = await registry.createLanguageModel(cachedAiConfig);
    }
    const reasoningEffort = resolveReasoningEffort(
      config.ai.aiEnv,
      "nlToSql",
      reasoningEffortOverride ?? options.reasoningEffort,
    );
    const providerOptions = reasoningEffort
      ? registry.resolveProviderOptions(cachedAiConfig, { reasoningEffort })
      : undefined;
    return { model: cachedModel, source: "registry", providerOptions };
  }

  return {
    reload() {
      cachedSchema = undefined;
      cachedModel = undefined;
      cachedAiConfig = undefined;
    },
    async bind(prepared, values, options = {}) {
      const { schema: schemaOverride, resolveTenantDescendants, tenantScope, ...guardrails } = options;
      const schema = schemaOverride ? loadFromSource(schemaOverride, "request") : resolveDefaultSchema();
      const tenantPolicy = "schemaId" in schema ? schema.tenantPolicy : undefined;
      // The same subtree expansion ask() runs, so a host never builds it by hand (ADR 0014).
      const scope =
        tenantPolicy && tenantScope
          ? await expandTenantScope(tenantPolicy, tenantScope, resolveTenantDescendants)
          : tenantScope;
      return bindPreparedQuery(prepared, values, { ...guardrails, schema, ...(scope ? { tenantScope: scope } : {}) });
    },
    async ask(question, overrides = {}) {
      const {
        schema: schemaOverride,
        model: modelOverride,
        dialect: dialectOverride,
        deps,
        reasoningEffort,
        omitSensitiveIdentifiersFromNlToSqlPrompt,
        mode: callMode,
        ...rest
      } = overrides;
      const schema = schemaOverride ? loadFromSource(schemaOverride, "request") : resolveDefaultSchema();
      const dialect = resolveDialect(schema, dialectOverride);
      const resolvedModel = await resolveModel(modelOverride, deps, reasoningEffort);
      options.onResolve?.({ dialect, modelSource: resolvedModel.source });

      // An explicit `deps.providerOptions` from the caller always wins over
      // the computed one; otherwise merge the resolved reasoning effort in.
      const finalDeps: AskGenerateDeps | undefined =
        resolvedModel.mockDeps ??
        (deps?.providerOptions !== undefined
          ? deps
          : resolvedModel.providerOptions !== undefined
            ? { ...deps, providerOptions: resolvedModel.providerOptions }
            : deps);

      // Config `modes.omitSensitiveFromPrompt` is a floor: a per-call override can
      // tighten it (true) but never loosen it (false) when the operator enabled it.
      const omitSensitive =
        omitSensitiveIdentifiersFromNlToSqlPrompt === true ||
        config.modes?.omitSensitiveFromPrompt === true;

      // Config `modes.askdbMode` (unset: `schema_only`) is the loosest mode a call gets:
      // a per-call `mode` can tighten it to `schema_only`, never loosen it (ADR 0025). Both go
      // through the same parser, so any accepted spelling tightens and an unknown mode throws.
      const configMode = parseAskDbModeV1(config.modes?.askdbMode);
      const requested = callMode == null ? undefined : parseAskDbModeV1(callMode);
      const mode = requested === "schema_only" ? requested : configMode;

      return ask({
        ...rest,
        mode,
        ...(omitSensitive ? { omitSensitiveIdentifiersFromNlToSqlPrompt: true } : {}),
        question,
        schema,
        model: resolvedModel.model,
        dialect: dialect.dialect,
        ...(finalDeps ? { deps: finalDeps } : {}),
      });
    },
  };
}
