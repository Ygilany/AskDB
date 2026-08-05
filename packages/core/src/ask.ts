import type { generateText as defaultGenerateText } from "ai";
import type { AskDbLanguageModel } from "./ai/types.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { AnyNormalizedSchema } from "./schema/types.js";
import { DEFAULT_ASKDB_MODE, type AskDbModeV1 } from "./modes/types.js";
import type { Retriever } from "./retrieval/types.js";
import { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
import type { NormalizedSchemaV2 } from "./schema/v2/normalized.js";
import type { TenantScope } from "./schema/v2/tenant-policy.js";
import {
  type BuiltInDialectId,
  type DialectSpec,
  getDialectSpec,
  isBuiltInDialectId,
} from "./sql/dialect-spec.js";
import { generateSelectSql } from "./sql/generate.js";
import {
  resolveTenantSql,
  type TenantSqlOutputMode,
  type TenantBinding,
} from "./sql/tenant-placeholders.js";
import { validateTenantScope } from "./sql/tenant-scope-validate.js";
import {
  bindPreparedQuery,
  sqlStructurallyEqual,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
} from "./sql/bind.js";

/** Options forwarded to a dialect's generator. Stable across dialects. */
export type AskDialectGenerateOptions = {
  logger?: AskDbLogger;
  explain?: boolean;
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  generateText?: typeof defaultGenerateText;
  providerOptions?: Record<string, unknown>;
  prebuiltDdl?: string;
  tenantPolicy?: import("./schema/v2/tenant-policy.js").NormalizedTenantPolicy;
  tenantScope?: TenantScope;
  /**
   * When true, ask the model for unbound SQL + a parameter manifest.
   * Inert for custom {@link AskDialect} implementations.
   */
  parameterize?: boolean;
};

/** Token usage for a single `ask()` call (LLM generation only; excludes RAG embedding tokens). */
export type AskUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

/** Output of a dialect's generator: validated SQL plus optional dialect-specific explain metadata. */
export type AskDialectGenerateResult = {
  sql: string;
  explain?: unknown;
  tenantGuardrail?: import("./sql/tenant-guardrail.js").TenantGuardrailResult;
  usage?: AskUsage;
  unboundNamedSql?: string;
  parameterManifest?: import("./sql/parameter-manifest.js").ParameterManifest;
};

/**
 * Escape-hatch interface for fully custom NL→SQL generators (agentic flows,
 * tool-calling, non-SELECT targets, fine-tuned models with bespoke prompts).
 *
 * 95% of consumers should pass a {@link BuiltInDialectId} (e.g. `"postgres"`) or
 * a {@link DialectSpec} to `ask({ dialect })` and let the centralized pipeline
 * handle prompt assembly + validation. Implement `AskDialect` only when those
 * defaults won't fit.
 */
export type AskDialect = {
  generate(
    question: string,
    schema: AnyNormalizedSchema,
    model: AskDbLanguageModel,
    options?: AskDialectGenerateOptions,
  ): Promise<AskDialectGenerateResult>;
};

/**
 * Anything `ask()` accepts as a dialect:
 *   - A {@link BuiltInDialectId} string (e.g. `"postgres"`) — looked up in the registry.
 *   - A {@link DialectSpec} object — descriptive; uses the centralized generator.
 *   - An {@link AskDialect} object — full escape hatch.
 */
export type AskDialectInput = BuiltInDialectId | DialectSpec | AskDialect;

/** Generic deps the pipeline forwards into the dialect (test-time mock for `generateText`, etc.). */
export type AskGenerateDeps = {
  generateText?: typeof defaultGenerateText;
  /**
   * Forwarded verbatim to the underlying `generateText` call's `providerOptions`.
   * Resolve provider-portable reasoning/latency effort (e.g. via `@askdb/ai`'s
   * `resolveProviderOptions`) and pass the result here — core stays BYO-model
   * and does not interpret or validate this bag. Unset preserves current
   * `generateText` call shapes exactly.
   */
  providerOptions?: Record<string, unknown>;
};

export type AskPipelineOptions = {
  question: string;
  schema: AnyNormalizedSchema;
  model: AskDbLanguageModel;
  /**
   * Required: the SQL dialect. Accepts a {@link BuiltInDialectId} (e.g. `"postgres"`),
   * a {@link DialectSpec} descriptor, or a fully custom {@link AskDialect} adapter.
   */
  dialect: AskDialectInput;
  /** When true, callers may inspect heuristic guardrail metadata (hosts/CLI). */
  explain?: boolean;
  /**
   * When true, omit sensitive table/column names from NL→SQL DDL. Default false — names are included
   * with `(sensitive)` tags so the model can ground SQL.
   */
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  deps?: AskGenerateDeps;
  /** Optional structured logger (host-provided — e.g. `createAskDbLogger` wraps Pino). */
  logger?: AskDbLogger;
  /**
   * Trust boundary for optional post-execute model paths. Default {@link DEFAULT_ASKDB_MODE}.
   * @see `docs/contracts/modes-v1.md`
   */
  mode?: AskDbModeV1;
  /**
   * Optional retriever from `@askdb/rag` (or any compatible implementation).
   * When supplied **and** the schema's chunk count exceeds
   * {@link retrievalThresholdChunks} (default 30), the retriever is called
   * with the user question and the retrieved chunks replace the full DDL
   * block in the NL→SQL prompt.
   *
   * When omitted, the Phase 5 behavior is preserved (full DDL inlined when
   * v2 fields exist).
   */
  retriever?: Retriever;
  /** Top-k forwarded to the retriever. Default 8. */
  retrievalK?: number;
  /**
   * Chunk-count threshold above which retrieval is preferred. When the
   * total chunk count for the schema is at or below this number, the full
   * DDL is inlined even if a retriever is supplied. Default 30.
   */
  retrievalThresholdChunks?: number;
  /**
   * Total chunk count for the indexed schema. Hosts that built the index
   * via `buildSchemaIndex` should pass `result.stats.chunksTotal` here so
   * the threshold check is meaningful. Defaults to `Infinity` — i.e. always
   * use the retriever when one is supplied — which matches the spec's
   * "consumer decides" stance for hosts that don't surface a count.
   */
  totalSchemaChunkCount?: number;
  /**
   * Tenant scope for the current user. Required when the schema has a
   * `tenant-policy.md` (the pipeline will fail closed without it).
   * Carries enforceable access + optional advisory context.
   */
  tenantScope?: TenantScope;
  /**
   * SQL output mode for tenant placeholders. Default `"sql-only"` inlines
   * literal values; `"sql-params"` converts to positional `$N` parameters.
   */
  tenantSqlMode?: TenantSqlOutputMode;
  /**
   * Ask the model to also return the SQL in unbound form plus a JSON manifest
   * of the values it parameterized, populating `unboundSql`, `params`,
   * `parameters`, and `preparedQuery`. Default true. Set false to save the
   * extra output tokens when the host does not use those fields.
   */
  parameterize?: boolean;
};

export type AskPipelineResult = {
  sql: string; // the model's bound SQL — unchanged meaning
  /** Driver markers; executable with `params`. */
  unboundSql?: string;
  /** Positional values for drivers (array slots on Postgres/CockroachDB listBinding). */
  params?: QueryParamSlot[];
  /** Named bindings for form UIs (includes runtime values). */
  parameters?: QueryParameterBinding[];
  /** Definitions + template only — no runtime values. */
  preparedQuery?: PreparedQuery;
  explain?: unknown;
  tenantGuardrail?: import("./sql/tenant-guardrail.js").TenantGuardrailResult;
  tenantParams?: unknown[];
  tenantBindings?: TenantBinding[];
  /** Token usage for the LLM generation call. Absent when the provider does not report usage. */
  usage?: AskUsage;
};

export async function ask(options: AskPipelineOptions): Promise<AskPipelineResult> {
  const logger = options.logger;
  const mode = options.mode ?? DEFAULT_ASKDB_MODE;
  logger?.info({ event: AskDbLogEvent.PipelineMode, mode }, "pipeline mode");

  // Tenant scope validation (fail closed when policy exists but no scope provided)
  const tenantPolicy = isV2Schema(options.schema) ? options.schema.tenantPolicy : undefined;
  if (tenantPolicy) {
    validateTenantScope(tenantPolicy, options.tenantScope);
    logger?.info(
      {
        event: AskDbLogEvent.TenantScopeValidated,
        scopeKind: options.tenantScope!.access.kind,
        enforcement: tenantPolicy.enforcement,
      },
      "tenant scope validated",
    );
  }

  const explainRequested = options.explain ?? false;
  const omitSensitive = options.omitSensitiveIdentifiersFromNlToSqlPrompt ?? false;
  const parameterize = options.parameterize !== false; // default true
  const prebuiltDdl = await maybeRetrieveDdl({
    options,
    logger,
    omitSensitive,
  });
  const dialectSpec = resolveDialectSpec(options.dialect);
  const dialect = resolveDialect(options.dialect);
  const generated = await dialect.generate(
    options.question,
    options.schema,
    options.model,
    {
      logger,
      explain: explainRequested,
      omitSensitiveIdentifiersFromNlToSqlPrompt: omitSensitive || undefined,
      generateText: options.deps?.generateText,
      providerOptions: options.deps?.providerOptions,
      prebuiltDdl,
      tenantPolicy,
      tenantScope: options.tenantScope,
      // Custom AskDialect implementations ignore this; built-in path uses it.
      parameterize: dialectSpec ? parameterize : undefined,
    },
  );
  // result.sql is always the model's bound SQL (possibly with tenant literals/
  // markers applied below). Never overwrite it with a re-bound version.
  const result: AskPipelineResult = { sql: generated.sql };
  if (generated.explain !== undefined) result.explain = generated.explain;
  if (generated.tenantGuardrail !== undefined) result.tenantGuardrail = generated.tenantGuardrail;
  if (generated.usage !== undefined) result.usage = generated.usage;

  // Parameterize extras: build PreparedQuery, consistency-check via bindPreparedQuery,
  // then populate result fields. Any failure drops extras only.
  let businessParamCount = 0;
  if (
    parameterize &&
    dialectSpec &&
    generated.unboundNamedSql &&
    generated.parameterManifest &&
    generated.parameterManifest.parameters.length > 0
  ) {
    const dialectId = dialectSpec.id as BuiltInDialectId;
    const businessParams = generated.parameterManifest.parameters.map((p) => ({
      name: p.name,
      placeholder: `:${p.name}`,
      type: p.type,
      cardinality: p.cardinality,
      description: p.description,
      source: "question" as const,
    }));

    // Tenant placeholders stay in namedSql for the host-facing PreparedQuery, but
    // bindPreparedQuery requires every placeholder to be declared. For the
    // consistency check we mask :tenant_* so only business values are substituted.
    const maskedNamed = maskTenantPlaceholders(generated.unboundNamedSql);
    const maskedBound = maskTenantPlaceholders(generated.sql);
    const preparedForBind: PreparedQuery = {
      version: 1,
      dialect: dialectId,
      namedSql: maskedNamed,
      parameters: businessParams,
    };
    const values: Record<string, QueryParameterValue | QueryParameterValue[]> = {};
    for (const p of generated.parameterManifest.parameters) {
      values[p.name] = p.value;
    }
    try {
      const bound = bindPreparedQuery(preparedForBind, values);
      if (!sqlStructurallyEqual(bound.sql, maskedBound)) {
        logger?.debug?.(
          {
            event: AskDbLogEvent.PipelineParameterized,
            parameterCount: 0,
            listParameterCount: 0,
            reason: "consistency_mismatch",
          },
          "parameterize extras dropped",
        );
      } else {
        const tenantDecls = scanTenantDecls(generated.unboundNamedSql);
        const prepared: PreparedQuery = {
          version: 1,
          dialect: dialectId,
          namedSql: generated.unboundNamedSql,
          parameters: [...businessParams, ...tenantDecls],
        };
        result.preparedQuery = prepared;
        result.parameters = bound.bindings.map((b) => ({
          ...b,
          // Restore real placeholder text (masking only affected namedSql).
        }));
        result.unboundSql = unmaskTenantPlaceholders(bound.unboundSql);
        result.params = bound.params;
        businessParamCount = bound.params.length;
        logger?.info(
          {
            event: AskDbLogEvent.PipelineParameterized,
            parameterCount: bound.bindings.length,
            listParameterCount: bound.bindings.filter((b) => b.cardinality === "many").length,
          },
          "parameterize extras attached",
        );
      }
    } catch {
      logger?.debug?.(
        {
          event: AskDbLogEvent.PipelineParameterized,
          parameterCount: 0,
          listParameterCount: 0,
          reason: "bind_failed",
        },
        "parameterize extras dropped",
      );
    }
  }

  if (tenantPolicy && options.tenantScope) {
    const tenantMode = options.tenantSqlMode ?? "sql-only";
    const paramStartIndex =
      tenantMode === "sql-params" && result.params ? businessParamCount + 1 : 1;
    const resolved = resolveTenantSql(
      result.sql,
      tenantPolicy,
      options.tenantScope,
      tenantMode,
      paramStartIndex,
      dialectSpec,
    );
    result.sql = resolved.sql;
    if (resolved.bindings.length > 0) result.tenantBindings = resolved.bindings;
    if (resolved.mode === "sql-params" && resolved.params.length > 0) {
      result.tenantParams = resolved.params;
    }

    if (result.preparedQuery && result.unboundSql) {
      if (tenantMode === "sql-only") {
        const unboundWithTenant = resolveTenantSql(
          result.unboundSql,
          tenantPolicy,
          options.tenantScope,
          "sql-only",
          1,
          dialectSpec,
        );
        result.unboundSql = unboundWithTenant.sql;
      } else {
        const unboundWithTenant = resolveTenantSql(
          result.unboundSql,
          tenantPolicy,
          options.tenantScope,
          "sql-params",
          paramStartIndex,
          dialectSpec,
        );
        if (unboundWithTenant.mode === "sql-params") {
          result.unboundSql = unboundWithTenant.sql;
          result.params = [
            ...(result.params ?? []),
            ...(unboundWithTenant.params as QueryParamSlot[]),
          ];
        }
      }
    }
  }

  return result;
}

const TENANT_MASK_RE = /:tenant_([a-z0-9_]+)_ids/g;
const TENANT_UNMASK_RE = /__askdb_tenant_([a-z0-9_]+)_ids__/g;

function maskTenantPlaceholders(sql: string): string {
  return sql.replace(TENANT_MASK_RE, "__askdb_tenant_$1_ids__");
}

function unmaskTenantPlaceholders(sql: string): string {
  return sql.replace(TENANT_UNMASK_RE, ":tenant_$1_ids");
}

function scanTenantDecls(namedSql: string): PreparedQuery["parameters"] {
  const seen = new Set<string>();
  const out: PreparedQuery["parameters"] = [];
  for (const m of namedSql.matchAll(/:tenant_([a-z0-9_]+)_ids/g)) {
    const name = `tenant_${m[1]}_ids`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      placeholder: `:${name}`,
      type: "string",
      cardinality: "many",
      source: "tenant",
    });
  }
  return out;
}

function isAskDialect(value: DialectSpec | AskDialect): value is AskDialect {
  return typeof (value as AskDialect).generate === "function";
}

/** Return the DialectSpec when the input is a built-in id or spec; undefined for custom AskDialect. */
function resolveDialectSpec(input: AskDialectInput): DialectSpec | undefined {
  if (typeof input === "string") {
    return isBuiltInDialectId(input) ? getDialectSpec(input) : undefined;
  }
  if (isAskDialect(input)) return undefined;
  return input;
}

/**
 * Normalize an {@link AskDialectInput} to an {@link AskDialect}. Built-in ids
 * and {@link DialectSpec}s are wrapped around the centralized
 * {@link generateSelectSql} generator; an {@link AskDialect} is passed through.
 */
function resolveDialect(input: AskDialectInput): AskDialect {
  if (typeof input === "string") {
    if (!isBuiltInDialectId(input)) {
      throw new Error(
        `Unknown dialect id '${input}'. Pass a built-in DialectId, a DialectSpec object, or a custom AskDialect.`,
      );
    }
    return specToDialect(getDialectSpec(input));
  }
  if (isAskDialect(input)) return input;
  return specToDialect(input);
}

function specToDialect(spec: DialectSpec): AskDialect {
  return {
    generate: (question, schema, model, options) =>
      generateSelectSql(spec, question, schema, model, options),
  };
}

/** Default chunk-count threshold below which the full DDL is preferred. */
const DEFAULT_RETRIEVAL_THRESHOLD_CHUNKS = 30;
const DEFAULT_RETRIEVAL_K = 8;

async function maybeRetrieveDdl(args: {
  options: AskPipelineOptions;
  logger: AskDbLogger | undefined;
  omitSensitive: boolean;
}): Promise<string | undefined> {
  const { options, logger, omitSensitive } = args;
  const retriever = options.retriever;
  if (!retriever) return undefined;

  if (!isV2Schema(options.schema)) {
    logger?.info(
      { event: AskDbLogEvent.PipelineRetrievalSkipped, reason: "schema_not_v2" },
      "retriever supplied but schema is not v2 — skipping retrieval",
    );
    return undefined;
  }

  const threshold = options.retrievalThresholdChunks ?? DEFAULT_RETRIEVAL_THRESHOLD_CHUNKS;
  const total = options.totalSchemaChunkCount ?? Number.POSITIVE_INFINITY;
  if (total <= threshold) {
    logger?.info(
      {
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "below_threshold",
        totalChunks: total,
        threshold,
      },
      "retriever supplied but schema is below threshold — using full DDL",
    );
    return undefined;
  }

  const k = options.retrievalK ?? DEFAULT_RETRIEVAL_K;
  const results = await retriever({
    question: options.question,
    k,
    filter: { schemaId: options.schema.schemaId },
  });
  if (results.length === 0) {
    logger?.info(
      {
        event: AskDbLogEvent.PipelineRetrievalSkipped,
        reason: "no_results",
        k,
        threshold,
        totalChunks: total === Number.POSITIVE_INFINITY ? null : total,
      },
      "retriever returned no chunks — using full DDL",
    );
    return undefined;
  }

  const synth = synthesizeRetrievedDdl({
    schema: options.schema,
    results,
    omitSensitiveIdentifiersFromPrompt: omitSensitive,
  });
  logger?.info(
    {
      event: AskDbLogEvent.PipelineRetrievalUsed,
      k,
      resultCount: results.length,
      tablesEmitted: synth.tablesEmitted,
      threshold,
      totalChunks: total === Number.POSITIVE_INFINITY ? null : total,
    },
    "retriever supplied focused DDL",
  );
  return synth.ddl;
}

function isV2Schema(schema: AnyNormalizedSchema): schema is NormalizedSchemaV2 {
  return "schemaId" in schema;
}
