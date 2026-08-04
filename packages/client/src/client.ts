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
  isBuiltInDialectId,
  loadSchema,
  loadSchemaFromJson,
  SUPPORTED_DIALECT_IDS,
  type AnyNormalizedSchema,
  type AskDbLanguageModel,
  type AskDialectInput,
  type AskGenerateDeps,
  type AskPipelineOptions,
  type AskPipelineResult,
} from "@askdb/core";
import type { BuiltInDialectId } from "@askdb/core";
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

/** Per-call options. Everything is optional; anything set overrides the client default. */
export type AskOverrides = Omit<
  AskPipelineOptions,
  "question" | "schema" | "model" | "dialect"
> & {
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
   * AI provider adapters (e.g. `[openaiProvider]` from `@askdb/ai-openai`).
   * The client builds the registry internally — the common path; you never
   * import from `@askdb/ai`. Pass exactly one of `providers` or `registry`.
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
  /** Drop cached schema + model so the next ask() re-resolves them. */
  reload(): void;
};

function resolveRegistry(options: CreateAskDbOptions): AiRegistry {
  if (options.registry && options.providers) {
    throw new Error("createAskDb: pass either `providers` or `registry`, not both.");
  }
  if (options.registry) return options.registry;
  if (options.providers) return createAiRegistry(options.providers);
  throw new Error(
    "createAskDb: pass `providers` with the AI adapters for your configured provider " +
      '(e.g. `providers: [openaiProvider]` from "@askdb/ai-openai"), or a prebuilt `registry`.',
  );
}

export function createAskDb(options: CreateAskDbOptions): AskDbClient {
  const { config } = options;
  const registry = resolveRegistry(options);
  let cachedSchema: AnyNormalizedSchema | undefined;
  let cachedModel: AskDbLanguageModel | undefined;
  let cachedAiConfig: AiConfig | undefined;

  function schemaSourceLabel(src: SchemaSource | AnyNormalizedSchema): string {
    if ("schemaId" in src) return "schema";
    if ("schema" in src) return "schema";
    if ("json" in src) return "json";
    return `path (${(src as { path: string }).path})`;
  }

  function loadFromSource(src: SchemaSource | AnyNormalizedSchema, label: string): AnyNormalizedSchema {
    if ("schemaId" in src) return src as AnyNormalizedSchema;
    if ("schema" in src) return (src as { schema: AnyNormalizedSchema }).schema;
    try {
      if ("json" in src) return loadSchemaFromJson((src as { json: string }).json);
      return loadSchema((src as { path: string }).path);
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
    const json = (host?.schemaJson?.trim() || env["ASKDB_SCHEMA_JSON"]?.trim()) || undefined;
    if (json) {
      cachedSchema = loadFromSource(
        { json },
        host?.schemaJson?.trim() ? "host.schemaJson" : "ASKDB_SCHEMA_JSON",
      );
      return cachedSchema;
    }
    const path = (host?.schemaPath?.trim() || env["ASKDB_SCHEMA_PATH"]?.trim()) || undefined;
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
    return "provider" in schema && typeof (schema as Record<string, unknown>)["provider"] === "string"
      ? (schema as Record<string, unknown>)["provider"] as string
      : undefined;
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
    async ask(question, overrides = {}) {
      const {
        schema: schemaOverride,
        model: modelOverride,
        dialect: dialectOverride,
        deps,
        reasoningEffort,
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

      return ask({
        ...rest,
        question,
        schema,
        model: resolvedModel.model,
        dialect: dialect.dialect,
        ...(finalDeps ? { deps: finalDeps } : {}),
      });
    },
  };
}
