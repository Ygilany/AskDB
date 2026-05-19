import type { LanguageModel, generateText as defaultGenerateText } from "ai";
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
  type TenantPlaceholderResult,
  type TenantBinding,
} from "./sql/tenant-placeholders.js";
import { validateTenantScope } from "./sql/tenant-scope-validate.js";

/** Options forwarded to a dialect's generator. Stable across dialects. */
export type AskDialectGenerateOptions = {
  logger?: AskDbLogger;
  explain?: boolean;
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  generateText?: typeof defaultGenerateText;
  prebuiltDdl?: string;
  tenantPolicy?: import("./schema/v2/tenant-policy.js").NormalizedTenantPolicy;
  tenantScope?: TenantScope;
};

/** Output of a dialect's generator: validated SQL plus optional dialect-specific explain metadata. */
export type AskDialectGenerateResult = {
  sql: string;
  explain?: unknown;
  tenantGuardrail?: import("./sql/tenant-guardrail.js").TenantGuardrailResult;
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
    model: LanguageModel,
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
};

export type AskPipelineOptions = {
  question: string;
  schema: AnyNormalizedSchema;
  model: LanguageModel;
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
};

export type AskPipelineResult = {
  sql: string;
  explain?: unknown;
  tenantGuardrail?: import("./sql/tenant-guardrail.js").TenantGuardrailResult;
  tenantParams?: unknown[];
  tenantBindings?: TenantBinding[];
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
  const prebuiltDdl = await maybeRetrieveDdl({
    options,
    logger,
    omitSensitive,
  });
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
      prebuiltDdl,
      tenantPolicy,
      tenantScope: options.tenantScope,
    },
  );
  let sql = generated.sql;
  const explain = generated.explain;
  const tenantGuardrail = generated.tenantGuardrail;
  const result: AskPipelineResult = { sql };
  if (explain !== undefined) result.explain = explain;
  if (tenantGuardrail !== undefined) result.tenantGuardrail = tenantGuardrail;

  if (tenantPolicy && options.tenantScope) {
    const mode = options.tenantSqlMode ?? "sql-only";
    const resolved = resolveTenantSql(sql, tenantPolicy, options.tenantScope, mode);
    result.sql = resolved.sql;
    if (resolved.bindings.length > 0) result.tenantBindings = resolved.bindings;
    if (resolved.mode === "sql-params" && resolved.params.length > 0) {
      result.tenantParams = resolved.params;
    }
  }

  return result;
}

function isAskDialect(value: DialectSpec | AskDialect): value is AskDialect {
  return typeof (value as AskDialect).generate === "function";
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
