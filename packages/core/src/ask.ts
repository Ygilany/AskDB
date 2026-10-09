import type { generateText as defaultGenerateText } from "ai";
import type { AskDbLanguageModel } from "./ai/types.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { AnyNormalizedSchema } from "./schema/types.js";
import { DEFAULT_ASKDB_MODE, type AskDbModeV1 } from "./modes/types.js";
import type { Retriever } from "./retrieval/types.js";
import { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
import { unqualifiedNamespaceFor } from "./sql/prompt.js";
import { promptIdentifierQuoter } from "./sql/prompt-identifiers.js";
import type { NormalizedSchemaV2 } from "./schema/v2/normalized.js";
import type { TenantScope } from "./schema/v2/tenant-policy.js";
import {
  type BuiltInDialectId,
  type DialectSpec,
  getDialectSpec,
  isBuiltInDialectId,
} from "./sql/dialect-spec.js";
import { generateSelectSqlForAsk } from "./sql/generate.js";
import {
  decide,
  sensitiveGuardrailResult,
  tenantFindings,
  tenantGuardrailResult,
  throwIfDenied,
} from "./sql/guardrail-decide.js";
import { evaluateGuardrails, guardrailPlan, logGuardrailVerdict } from "./sql/guardrails.js";
import { bindTenantIntoUnboundSql } from "./sql/rebind.js";
import type { TenantGuardrailResult } from "./sql/tenant-guardrail.js";
import {
  resolveTenantSql,
  type TenantSqlOutputMode,
  type TenantBinding,
} from "./sql/tenant-placeholders.js";
import {
  expandTenantScope,
  type ResolveTenantDescendants,
  type TenantIdsByRoot,
} from "./sql/tenant-scope-expand.js";
import { validateTenantScope } from "./sql/tenant-scope-validate.js";
import {
  type SensitiveGuardrailMode,
  type SensitiveGuardrailResult,
} from "./sql/sensitive-guardrail.js";
import {
  UnknownDialectError,
  type GuardrailFinding,
  type GuardrailVerdict,
} from "./errors.js";
import {
  renderPreparedQuery,
  scanTenantPlaceholders,
  sqlStructurallyEqual,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
} from "./sql/bind.js";

export type { ResolveTenantDescendants, TenantIdsByRoot };

/** Options forwarded to a dialect's generator. Stable across dialects. */
export type AskDialectGenerateOptions = {
  logger?: AskDbLogger;
  explain?: boolean;
  omitSensitiveIdentifiersFromNlToSqlPrompt?: boolean;
  generateText?: typeof defaultGenerateText;
  providerOptions?: Record<string, unknown>;
  /** The caller's {@link AskPipelineOptions.abortSignal}. A custom dialect passes it to its model call. */
  abortSignal?: AbortSignal;
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

/** Output of a dialect's generator: the generated SQL plus optional dialect-specific explain metadata. */
export type AskDialectGenerateResult = {
  sql: string;
  explain?: unknown;
  /**
   * Optional tenant guardrail result from a custom generator. When the schema has a
   * tenant policy, its warnings become tenant findings (`form: "generator"`) next to
   * `ask()`'s own check of `sql` and `unboundNamedSql`, decided under the policy's
   * `enforcement`; `passed: false` with no warnings becomes one `UNPROVABLE_SCOPE`
   * finding. It can add findings but never replace or relax that check. Without a tenant
   * policy it is passed through to `result.tenantGuardrail` unchanged.
   */
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
 *
 * Safety responsibilities:
 *   - **Read-only validation is yours.** `ask()` does not run the SELECT-only
 *     validator on SQL returned by a custom dialect (custom dialects may target
 *     non-SELECT statements on purpose). If your generator should only emit
 *     read-only SQL, call the exported `validateSelectSql(spec, sql)` yourself
 *     before returning.
 *   - **Tenant enforcement is not yours to skip.** When the schema has a tenant
 *     policy, `ask()` runs the tenant guardrail on the returned `sql` (and
 *     `unboundNamedSql`), with its `:tenant_<root>_ids` placeholders still in place,
 *     then substitutes them, regardless of dialect; `strict` policies throw
 *     `TenantGuardrailError`. A `tenantGuardrail` your generator returns adds
 *     findings to that check (`form: "generator"`), never replaces it.
 *   - The sensitive-identifier check runs on your SQL too, unless
 *     `sensitiveGuardrailMode` is `"off"`.
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
  /**
   * Cancels the NL→SQL model call (`generateText({ abortSignal })`), e.g.
   * `AbortSignal.timeout(60_000)` for a per-request timeout. With a built-in dialect an
   * aborted call rejects with `SqlGenerationError` (the abort reason is its `cause`). A
   * custom {@link AskDialect} receives it in its `generate()` options and maps its own errors.
   */
  abortSignal?: AbortSignal;
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
   * escaped literal values. `"sql-params"` replaces them with the dialect's
   * driver markers (`$N` for Postgres/CockroachDB and custom `AskDialect`s, `?`
   * for MySQL/MariaDB/SQLite, `@pN` for SQL Server): run `sql` with
   * `tenantParams`, or `unboundSql` with `params`.
   */
  tenantSqlMode?: TenantSqlOutputMode;
  /**
   * Expands a `subtree` tenant scope into IDs per tenant root.
   *
   * Called with the tenant root id and the seed IDs from
   * `tenantScope.access.rootIds`; returns the subtree's IDs keyed by root table id
   * ({@link TenantIdsByRoot}). `ask()` unions the seeds into the `tenantRoot` entry
   * and turns the result into a `multi_root` scope (an `ids` scope when only
   * `tenantRoot` has IDs), so each root's IDs bind only to that root's placeholder.
   * The host is the right place for this: it already knows its own hierarchy, can
   * cache the closure, and can apply its own authorization rules.
   *
   * Required when `tenantScope.access.kind === "subtree"` — AskDB never opens a
   * database connection of its own. Without it, or when it returns a flat array,
   * a key that isn't a root in the subtree, a value that isn't an array of
   * non-empty strings, or no IDs at all, `ask()` throws `TenantScopeError`
   * (`SUBTREE_NOT_RESOLVABLE`) before calling the model.
   */
  resolveTenantDescendants?: ResolveTenantDescendants;
  /**
   * Ask the model to also return the SQL in unbound form plus a JSON manifest
   * of the values it parameterized, populating `unboundSql`, `params`,
   * `parameters`, and `preparedQuery`. Default true. Set false to save the
   * extra output tokens when the host does not use those fields.
   */
  parameterize?: boolean;
  /**
   * How to treat SQL that references schema identifiers marked `sensitive`.
   * Default `"warn"` — {@link AskPipelineResult.sensitiveGuardrail} is populated and
   * `askdb.pipeline.sensitive_sql_warning` is logged, but `ask()` still resolves.
   * `"strict"` throws {@link SensitiveReferenceError} instead. `"off"` skips the check.
   *
   * Covers SQL produced by *this* call. A rebind with `bindPreparedQuery()` runs the
   * check again on the stored template; hosts that store and replay `sql` itself should
   * call `validateSensitiveReferences` on that path.
   */
  sensitiveGuardrailMode?: SensitiveGuardrailMode | "off";
};

export type AskPipelineResult = {
  /**
   * The model's bound SQL: business values inlined as literals. Tenant IDs are
   * inlined literals (`tenantSqlMode: "sql-only"`) or driver markers numbered from
   * the first slot (`"sql-params"`) — then execute it with `tenantParams`.
   */
  sql: string;
  /**
   * Driver markers for every value (business and, in `"sql-params"` mode, tenant).
   * Execute with `params` — never with `tenantParams`.
   */
  unboundSql?: string;
  /**
   * Values for `unboundSql`, in driver-marker order (array slots on
   * Postgres/CockroachDB listBinding). In `"sql-params"` mode this already
   * includes the tenant values — for `?` dialects interleaved in source order,
   * otherwise after the business values. Do not concatenate `tenantParams`.
   */
  params?: QueryParamSlot[];
  /** Named bindings for form UIs (includes runtime values). */
  parameters?: QueryParameterBinding[];
  /** Definitions + template only — no runtime values. */
  preparedQuery?: PreparedQuery;
  explain?: unknown;
  /**
   * Every guardrail finding for the model's SQL, checked before AskDB renders it (its
   * bound `sql` and `sql-unbound` block, with the `:tenant_<root>_ids` placeholders still
   * in place), and the outcome: `allow`, or `warn` when a `warn`-mode check found
   * something. A `deny` throws the check's typed error instead, with this verdict on it.
   */
  verdict: GuardrailVerdict;
  /**
   * Sensitive-identifier guardrail result, derived from {@link verdict}. Present when the
   * schema declares at least one `sensitive` table/column and `sensitiveGuardrailMode` is
   * not `"off"`.
   */
  sensitiveGuardrail?: SensitiveGuardrailResult;
  /**
   * Tenant guardrail result, derived from {@link verdict}: its tenant findings, once each.
   * `sql` and `unboundSql` differ from the checked forms only by the substituted tenant IDs
   * or markers. Present whenever the schema has a tenant policy, for every dialect form.
   * In `strict` mode a failure throws `TenantGuardrailError` instead, so a returned result
   * is always `passed` under `strict`.
   */
  tenantGuardrail?: import("./sql/tenant-guardrail.js").TenantGuardrailResult;
  /**
   * `"sql-params"` mode only: the tenant IDs for the markers in `sql`, in marker
   * order. `sql` + `tenantParams` is an executable pair on its own.
   */
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
  // A `subtree` scope is expanded to IDs per root here, before generation, so the
  // prompt, guardrail, and placeholder substitution all see the same per-root
  // access — and a missing or malformed resolver fails before any model call is spent.
  const tenantScope =
    tenantPolicy && options.tenantScope
      ? await expandTenantScope(tenantPolicy, options.tenantScope, options.resolveTenantDescendants)
      : options.tenantScope;

  const explainRequested = options.explain ?? false;
  const omitSensitive = options.omitSensitiveIdentifiersFromNlToSqlPrompt ?? false;
  const parameterize = options.parameterize !== false; // default true
  const dialectSpec = resolveDialectSpec(options.dialect);
  const prebuiltDdl = await maybeRetrieveDdl({
    options,
    logger,
    omitSensitive,
    unqualifiedNamespace: unqualifiedNamespaceFor(options.schema, dialectSpec?.unqualifiedNamespace),
    quoteIdentifier: dialectSpec ? promptIdentifierQuoter(dialectSpec) : undefined,
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
      providerOptions: options.deps?.providerOptions,
      abortSignal: options.abortSignal,
      prebuiltDdl,
      tenantPolicy,
      tenantScope,
      // Custom AskDialect implementations ignore this; built-in path uses it.
      parameterize: dialectSpec ? parameterize : undefined,
    },
  );
  // The guardrails run on the model's forms before AskDB renders them (ADR 0010): its
  // bound `sql` and its `sql-unbound` block, with the `:tenant_<root>_ids` placeholders
  // still in place. Rendering below only swaps placeholders for literals or driver
  // markers, so one check covers every tenantSqlMode, dialect and output form. A custom
  // AskDialect (no DialectSpec) gets no read-only check: it may target non-SELECT SQL.
  const tenant = tenantPolicy && tenantScope ? { policy: tenantPolicy, scope: tenantScope } : undefined;
  const { checks, modes } = guardrailPlan("ask", {
    dialect: dialectSpec,
    schema: options.schema,
    tenantPolicy: tenant?.policy,
    sensitiveGuardrailMode: options.sensitiveGuardrailMode,
  });
  const runSensitive = checks.includes("sensitive");
  const findings = evaluateGuardrails(
    {
      forms: {
        sql: generated.sql,
        ...(generated.unboundNamedSql !== undefined ? { template: generated.unboundNamedSql } : {}),
      },
      dialect: dialectSpec,
      schema: options.schema,
      ...(tenant ? { tenant } : {}),
    },
    checks,
  );
  if (tenant) findings.push(...generatorFindings(generated.tenantGuardrail));
  const verdict = decide(findings, modes, "return");
  logGuardrailVerdict(logger, verdict, { tenantPolicy, sensitiveChecked: runSensitive });
  throwIfDenied(verdict, modes, "return");

  // result.sql is always the model's bound SQL (possibly with tenant literals/
  // markers applied below). Never overwrite it with a re-bound version.
  const result: AskPipelineResult = { sql: generated.sql, verdict };
  if (generated.explain !== undefined) result.explain = generated.explain;
  if (tenant) {
    result.tenantGuardrail = tenantGuardrailResult(findings);
  } else if (generated.tenantGuardrail !== undefined) {
    // Without a tenant policy there is no mode to decide with: pass through what a
    // custom dialect reported.
    result.tenantGuardrail = generated.tenantGuardrail;
  }
  if (runSensitive) result.sensitiveGuardrail = sensitiveGuardrailResult(findings);
  if (generated.usage !== undefined) result.usage = generated.usage;

  // Reuse artifacts: bind the template's business values with the mechanical renderer,
  // leaving its tenant placeholders in place, and keep them only when that reproduces the
  // model's `sql`. Any failure drops the artifacts only.
  if (
    parameterize &&
    dialectSpec &&
    generated.unboundNamedSql &&
    generated.parameterManifest &&
    generated.parameterManifest.parameters.length > 0
  ) {
    const prepared: PreparedQuery = {
      version: 1,
      dialect: dialectSpec.id as BuiltInDialectId,
      namedSql: generated.unboundNamedSql,
      parameters: [
        ...generated.parameterManifest.parameters.map((p) => ({
          name: p.name,
          placeholder: `:${p.name}`,
          type: p.type,
          cardinality: p.cardinality,
          description: p.description,
          source: "question" as const,
        })),
        ...tenantDecls(generated.unboundNamedSql, dialectSpec),
      ],
    };
    const values: Record<string, QueryParameterValue | QueryParameterValue[]> = {};
    for (const p of generated.parameterManifest.parameters) {
      values[p.name] = p.value;
    }
    try {
      const bound = renderPreparedQuery(prepared, values, { skipTenantPlaceholders: true });
      if (!sqlStructurallyEqual(bound.sql, generated.sql)) {
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
        result.preparedQuery = prepared;
        result.parameters = bound.bindings;
        result.unboundSql = bound.unboundSql;
        result.params = bound.params;
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

  if (tenant) {
    const tenantMode = options.tenantSqlMode ?? "sql-only";
    // `sql` carries business values as inlined literals, so its only markers are
    // tenant markers, numbered from the first slot: `sql` runs with `tenantParams`
    // alone. `unboundSql` runs with the combined `params` (handled below).
    const resolved = resolveTenantSql(result.sql, tenant.policy, tenant.scope, tenantMode, 1, dialectSpec);
    result.sql = resolved.sql;
    if (resolved.bindings.length > 0) result.tenantBindings = resolved.bindings;
    if (resolved.mode === "sql-params" && resolved.params.length > 0) {
      result.tenantParams = resolved.params;
    }

    if (result.preparedQuery && result.unboundSql !== undefined && result.params && result.parameters) {
      if (tenantMode === "sql-only") {
        result.unboundSql = resolveTenantSql(
          result.unboundSql,
          tenant.policy,
          tenant.scope,
          "sql-only",
          1,
          dialectSpec,
        ).sql;
      } else {
        const rendered = bindTenantIntoUnboundSql(
          { unboundSql: result.unboundSql, params: result.params, bindings: result.parameters },
          {
            namedSql: result.preparedQuery.namedSql,
            tenantPolicy: tenant.policy,
            tenantScope: tenant.scope,
            dialectSpec,
          },
        );
        if (rendered) {
          result.unboundSql = rendered.unboundSql;
          result.params = rendered.params;
          result.parameters = rendered.bindings;
        } else {
          dropParameterizeExtras(result);
          logger?.debug?.(
            {
              event: AskDbLogEvent.PipelineParameterized,
              parameterCount: 0,
              listParameterCount: 0,
              reason: "tenant_param_alignment",
            },
            "parameterize extras dropped",
          );
        }
      }
    }
  }

  return result;
}

/**
 * A custom generator's `tenantGuardrail`, as tenant findings: its warnings, and one
 * `UNPROVABLE_SCOPE` finding for a failure it reported without any, so it is never
 * dropped. They add to `ask()`'s own check; they never replace it.
 */
function generatorFindings(reported: TenantGuardrailResult | undefined): GuardrailFinding[] {
  if (!reported) return [];
  const findings = tenantFindings(reported.warnings ?? [], "generator");
  if (reported.passed === false && findings.length === 0) {
    findings.push({
      check: "tenant",
      form: "generator",
      rule: "UNPROVABLE_SCOPE",
      tableId: "",
      message: "The custom SQL generator reported a failed tenant guardrail without details.",
    });
  }
  return findings;
}

function dropParameterizeExtras(result: AskPipelineResult): void {
  delete result.unboundSql;
  delete result.params;
  delete result.parameters;
  delete result.preparedQuery;
}

/** A declaration per distinct `:tenant_<root>_ids` placeholder in the template. */
function tenantDecls(namedSql: string, dialect: DialectSpec): PreparedQuery["parameters"] {
  const names = new Set(scanTenantPlaceholders(namedSql, dialect).map((p) => p.name));
  return [...names].map((name) => ({
    name,
    placeholder: `:${name}`,
    type: "string",
    cardinality: "many",
    source: "tenant",
  }));
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
      throw new UnknownDialectError(
        `Unknown dialect id '${input}'. Pass a built-in DialectId, a DialectSpec object, or a custom AskDialect.`,
        input,
      );
    }
    return specToDialect(getDialectSpec(input));
  }
  if (isAskDialect(input)) return input;
  return specToDialect(input);
}

function specToDialect(spec: DialectSpec): AskDialect {
  return {
    // ask() runs the guardrails itself, on the same forms, through one decision point.
    generate: (question, schema, model, options) =>
      generateSelectSqlForAsk(spec, question, schema, model, options),
  };
}

/** Default chunk-count threshold below which the full DDL is preferred. */
const DEFAULT_RETRIEVAL_THRESHOLD_CHUNKS = 30;
const DEFAULT_RETRIEVAL_K = 8;

async function maybeRetrieveDdl(args: {
  options: AskPipelineOptions;
  logger: AskDbLogger | undefined;
  omitSensitive: boolean;
  unqualifiedNamespace: string | undefined;
  quoteIdentifier: ((name: string) => string) | undefined;
}): Promise<string | undefined> {
  const { options, logger, omitSensitive, unqualifiedNamespace, quoteIdentifier } = args;
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
    unqualifiedNamespace,
    quoteIdentifier,
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
