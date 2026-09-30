import type { generateText as defaultGenerateText } from "ai";
import type { AskDbLanguageModel } from "./ai/types.js";
import type { AskDbLogger } from "./logging/askdb-logger.js";
import { AskDbLogEvent } from "./logging/log-events.js";
import type { AnyNormalizedSchema } from "./schema/types.js";
import { DEFAULT_ASKDB_MODE, type AskDbModeV1 } from "./modes/types.js";
import type { Retriever } from "./retrieval/types.js";
import { synthesizeRetrievedDdl } from "./retrieval/synthesize-ddl.js";
import type { NormalizedSchemaV2 } from "./schema/v2/normalized.js";
import type {
  NormalizedTenantPolicy,
  TenantAccess,
  TenantScope,
} from "./schema/v2/tenant-policy.js";
import {
  type BuiltInDialectId,
  type DialectSpec,
  getDialectSpec,
  isBuiltInDialectId,
} from "./sql/dialect-spec.js";
import { generateSelectSqlWithoutTenantGuardrail } from "./sql/generate.js";
import { enforceTenantGuardrails } from "./sql/tenant-guardrail.js";
import {
  resolveTenantSql,
  type TenantSqlOutputMode,
  type TenantBinding,
} from "./sql/tenant-placeholders.js";
import { subtreeRootIds } from "./sql/tenant-hierarchy.js";
import { validateTenantScope } from "./sql/tenant-scope-validate.js";
import {
  formatSensitiveReference,
  schemaHasSensitiveIdentifiers,
  validateSensitiveReferences,
  type SensitiveGuardrailMode,
  type SensitiveGuardrailResult,
} from "./sql/sensitive-guardrail.js";
import {
  SensitiveReferenceError,
  TenantScopeError,
  UnknownDialectError,
  type SensitiveReference,
} from "./errors.js";
import {
  bindPreparedQuery,
  markerStyleForDialect,
  scanPlaceholders,
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

/** Output of a dialect's generator: the generated SQL plus optional dialect-specific explain metadata. */
export type AskDialectGenerateResult = {
  sql: string;
  explain?: unknown;
  /**
   * Optional tenant guardrail result from a custom generator. When the schema has a
   * tenant policy, `ask()` merges its warnings into its own check of `sql` and
   * `unboundNamedSql` (before tenant rendering); it can add failures but never replace
   * or relax that check.
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
 *     `TenantGuardrailError`. A `tenantGuardrail` your
 *     generator returns is merged into that result, never used in place of it.
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

/**
 * A subtree's IDs grouped by tenant root: each key is a root table id from the
 * tenant policy (`"table:public.clients"`), and its value holds IDs of that root's
 * own `tenantIdColumn`, never IDs of another root.
 *
 * Root tables have separate ID spaces, so client `5` and agency `5` are different
 * tenants. Keying the IDs by root lets `ask()` bind each root's IDs to that root's
 * own `:tenant_<label>_ids` placeholder.
 */
export type TenantIdsByRoot = Readonly<Record<string, readonly string[]>>;

/**
 * Host callback that expands a `subtree` tenant scope. Given the tenant root id and
 * the seed IDs, return the subtree's IDs grouped by root ({@link TenantIdsByRoot}):
 *
 * - under `tenantRoot`: the seeds and any same-table descendants (e.g. child
 *   agencies through `agencies.parent_agency_id`);
 * - under each descendant root the policy declares (`roots[].parent` or
 *   `hierarchy[]`): that root's IDs in the subtree.
 *
 * Pass it to `ask()` as {@link AskPipelineOptions.resolveTenantDescendants}.
 */
export type ResolveTenantDescendants = (
  tenantRoot: string,
  seedIds: readonly string[],
) => Promise<TenantIdsByRoot> | TenantIdsByRoot;

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
   * This only covers SQL produced by *this* call. Hosts that cache or replay SQL
   * should call `validateSensitiveReferences` on every execution path.
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
   * Sensitive-identifier guardrail result for `sql`. Present when the schema declares
   * at least one `sensitive` table/column and `sensitiveGuardrailMode` is not `"off"`.
   */
  sensitiveGuardrail?: SensitiveGuardrailResult;
  /**
   * Tenant guardrail result for the model's SQL, checked before tenant rendering: the
   * bound `sql` and its `sql-unbound` block, with the `:tenant_<root>_ids` placeholders
   * still in place. `sql` and `unboundSql` differ from those only by the substituted
   * tenant IDs or markers. Present whenever the schema has a tenant policy, for every
   * dialect form. In `strict` mode a failure
   * throws `TenantGuardrailError` instead, so a returned result is always `passed`
   * under `strict`.
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
      ? await expandSubtreeScope(tenantPolicy, options.tenantScope, options.resolveTenantDescendants)
      : options.tenantScope;

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
      tenantScope,
      // Custom AskDialect implementations ignore this; built-in path uses it.
      parameterize: dialectSpec ? parameterize : undefined,
    },
  );
  // result.sql is always the model's bound SQL (possibly with tenant literals/
  // markers applied below). Never overwrite it with a re-bound version.
  const result: AskPipelineResult = { sql: generated.sql };
  if (generated.explain !== undefined) result.explain = generated.explain;
  // With a tenant policy, `tenantGuardrail` is computed below, before tenant rendering;
  // without one, pass through whatever a custom dialect reported.
  if (!tenantPolicy && generated.tenantGuardrail !== undefined) {
    result.tenantGuardrail = generated.tenantGuardrail;
  }
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

  if (tenantPolicy && tenantScope) {
    // Tenant guardrail on the untrusted SQL, before rendering: the model's bound
    // statement and its unbound block, with the `:tenant_<root>_ids` placeholders
    // still in place. Rendering below only swaps each placeholder for literals or
    // driver markers, so one check covers every tenantSqlMode, dialect and output
    // form (#315). Runs for every dialect (built-in, DialectSpec, or custom
    // AskDialect); the built-in generator skips its own check so this is the single
    // report. `dialectSpec` is undefined for a custom AskDialect: the guardrail then
    // requires the statement to pass under the standard-SQL, Postgres and MySQL readings.
    result.tenantGuardrail = enforceTenantGuardrails(
      [result.sql, generated.unboundNamedSql],
      tenantPolicy,
      tenantScope,
      logger,
      generated.tenantGuardrail,
      dialectSpec,
    );

    const tenantMode = options.tenantSqlMode ?? "sql-only";
    // `sql` carries business values as inlined literals, so its only markers are
    // tenant markers, numbered from the first slot: `sql` runs with `tenantParams`
    // alone. `unboundSql` runs with the combined `params` (handled below).
    const resolved = resolveTenantSql(
      result.sql,
      tenantPolicy,
      tenantScope,
      tenantMode,
      1,
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
          tenantScope,
          "sql-only",
          1,
          dialectSpec,
        );
        result.unboundSql = unboundWithTenant.sql;
      } else if (
        !bindTenantIntoUnboundSql(result, {
          namedSql: result.preparedQuery.namedSql,
          businessParamCount,
          tenantPolicy,
          tenantScope,
          dialectSpec,
        })
      ) {
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

  applySensitiveGuardrail(result, options, dialectSpec, logger);

  return result;
}

/**
 * Replace a `subtree` access with the per-root access it expands to: `multi_root`
 * with one entry per root the subtree covers (the scope's root first, then its
 * descendant roots breadth-first), including a level with no IDs (`ids: []`), or `ids`
 * when the subtree is the scope's root alone. Other access kinds pass through untouched.
 *
 * Each root's IDs stay under that root, so they bind only to its own placeholder:
 * root tables have separate ID spaces, and folding a client ID into the agency
 * placeholder would match another agency (#338). This relies on every root deriving a distinct
 * placeholder, which `validateTenantScope()` and the policy loader enforce. The seeds are unioned into the
 * `tenantRoot` entry here, not trusted to the resolver, so an ancestor never loses
 * its own rows when a host returns strict descendants only.
 *
 * Fails closed with `SUBTREE_NOT_RESOLVABLE`: no resolver; a result that is an
 * array (the old flat shape) or not a plain object; a key that isn't a root in
 * this subtree; a value that isn't an array of non-empty strings; or no IDs at all.
 */
async function expandSubtreeScope(
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  resolve: ResolveTenantDescendants | undefined,
): Promise<TenantScope> {
  const access = scope.access;
  if (access.kind !== "subtree") return scope;
  const { tenantRoot, rootIds } = access;
  const levels = subtreeRootIds(policy, tenantRoot);
  const shape = `{ ${levels.map((root) => `"${root}": [...]`).join(", ")} }`;
  const fail = (message: string) => new TenantScopeError(message, "SUBTREE_NOT_RESOLVABLE");

  if (!resolve) {
    throw fail(
      `tenantScope.access is a 'subtree' of '${tenantRoot}', but no ` +
        "resolveTenantDescendants was passed to ask(). AskDB does not query your database " +
        "to find descendants: pass resolveTenantDescendants to expand the seed IDs, or pass " +
        "an 'ids' or 'multi_root' access with each root's IDs already expanded.",
    );
  }

  const result: unknown = await resolve(tenantRoot, rootIds);
  if (Array.isArray(result)) {
    throw fail(
      `resolveTenantDescendants for '${tenantRoot}' returned an array. It must return IDs per ` +
        `tenant root, keyed by root table id: ${shape}. Root tables have separate ID spaces, so ` +
        "a flat list can't say which root each ID belongs to, and binding them all to " +
        `'${tenantRoot}' would match other tenants. Put the seeds and any same-table ` +
        `descendants under '${tenantRoot}', and each descendant root's IDs under that root.`,
    );
  }
  if (!isPlainObject(result)) {
    throw fail(
      `resolveTenantDescendants for '${tenantRoot}' must return an object mapping each ` +
        `tenant root in the subtree to its IDs: ${shape}.`,
    );
  }

  // Read the result exactly once: validate and build from this snapshot, so a getter
  // can't return one value to validation and another to the scope, and a property
  // validation can't see (non-enumerable) is never read at all.
  const idsByRoot = new Map<string, readonly string[]>();
  const knownRoots = new Set(policy.roots.map((root) => root.id));
  let returned = 0;
  for (const [root, value] of Object.entries(result)) {
    const ids: unknown = Array.isArray(value) ? [...value] : value;
    if (!knownRoots.has(root)) {
      throw fail(
        `resolveTenantDescendants returned IDs under a key the subtree can't have: '${root}' is ` +
          `not a tenant root in the policy. Allowed keys for a subtree of '${tenantRoot}': ` +
          `${levels.join(", ")}.`,
      );
    }
    if (!levels.includes(root)) {
      throw fail(
        `resolveTenantDescendants returned IDs under a key the subtree can't have: '${root}' is ` +
          `not in the subtree of '${tenantRoot}' (the policy's hierarchy doesn't reach it from ` +
          `there). Allowed keys: ${levels.join(", ")}.`,
      );
    }
    if (!isTenantIdArray(ids)) {
      throw fail(`resolveTenantDescendants: the IDs for '${root}' must be an array of non-empty strings.`);
    }
    idsByRoot.set(root, ids);
    returned += ids.length;
  }
  if (returned === 0) {
    throw fail(
      `resolveTenantDescendants returned no IDs for '${tenantRoot}' (seeds: ${rootIds.join(", ")}). ` +
        `Return at least the seeds under '${tenantRoot}'; refusing to build an empty tenant scope.`,
    );
  }

  // Every level the subtree covers stays in the scope, even one with no IDs. The
  // guardrail then checks a read of that root on its own placeholder, and binding that
  // placeholder fails closed (UNRESOLVED_TENANT_PLACEHOLDER). Dropping the level would
  // leave its rows readable through a parent's foreign key or an ancestor, which is
  // less restricted than a level the resolver narrowed to some IDs.
  const scopes = levels.map((root) => {
    const own = idsByRoot.get(root) ?? [];
    return { tenantRoot: root, ids: [...new Set(root === tenantRoot ? [...rootIds, ...own] : own)] };
  });
  const expanded: TenantAccess =
    scopes.length === 1 ? { kind: "ids", ...scopes[0]! } : { kind: "multi_root", scopes };
  return { ...scope, access: expanded };
}

function isTenantIdArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Run the sensitive-identifier guardrail over the SQL the host is about to receive.
 * Runs after tenant resolution so it sees exactly the statement in `result.sql`.
 * With a built-in id or `DialectSpec`, the SQL is lexed the way that engine reads it;
 * for a custom `AskDialect` (no spec) references are unioned across every built-in reading.
 */
function applySensitiveGuardrail(
  result: AskPipelineResult,
  options: AskPipelineOptions,
  dialectSpec: DialectSpec | undefined,
  logger: AskDbLogger | undefined,
): void {
  const mode = options.sensitiveGuardrailMode ?? "warn";
  if (mode === "off") return;
  if (!schemaHasSensitiveIdentifiers(options.schema)) return;

  try {
    const guardrail = validateSensitiveReferences(result.sql, options.schema, {
      mode,
      dialect: dialectSpec,
    });
    result.sensitiveGuardrail = guardrail;
    logSensitiveReferences(logger, guardrail.references);
  } catch (error) {
    if (error instanceof SensitiveReferenceError) {
      logSensitiveReferences(logger, error.references);
    }
    throw error;
  }
}

function logSensitiveReferences(
  logger: AskDbLogger | undefined,
  references: SensitiveReference[],
): void {
  if (references.length === 0) return;
  const sensitiveColumns = references.map(formatSensitiveReference);
  logger?.info(
    {
      event: AskDbLogEvent.PipelineSensitiveSqlWarning,
      sensitiveColumnCount: sensitiveColumns.length,
      sensitiveColumns,
    },
    "generated SQL references sensitive identifiers",
  );
}

/**
 * Substitute tenant placeholders in `result.unboundSql` with driver markers and
 * fold their values into `result.params`, so `unboundSql` + `params` is a single
 * executable pair (`sql-params` mode).
 *
 * - `$N` / `@pN` dialects: markers are explicitly numbered, so tenant markers
 *   continue after the business slots and tenant values are appended.
 * - `?` dialects: markers are positional, so `params` must follow source order.
 *   Business and tenant values are interleaved by walking the named template in
 *   order, and `parameters[].indices` are remapped to the new positions.
 *
 * Returns false when the business binding and the tenant substitution disagree
 * about the statement's shape; the caller then drops the extras rather than ship
 * misaligned params.
 */
function bindTenantIntoUnboundSql(
  result: AskPipelineResult,
  ctx: {
    namedSql: string;
    businessParamCount: number;
    tenantPolicy: import("./schema/v2/tenant-policy.js").NormalizedTenantPolicy;
    tenantScope: TenantScope;
    dialectSpec: DialectSpec | undefined;
  },
): boolean {
  if (result.unboundSql === undefined) return false;
  const unbound = resolveTenantSql(
    result.unboundSql,
    ctx.tenantPolicy,
    ctx.tenantScope,
    "sql-params",
    ctx.businessParamCount + 1,
    ctx.dialectSpec,
  );
  if (unbound.mode !== "sql-params") return false;
  const business = result.params ?? [];
  const tenantValues = unbound.params as QueryParamSlot[];

  const dialectId = ctx.dialectSpec?.id;
  const style =
    dialectId !== undefined && isBuiltInDialectId(dialectId)
      ? markerStyleForDialect(dialectId)
      : "dollar";
  if (style !== "question") {
    result.unboundSql = unbound.sql;
    result.params = [...business, ...tenantValues];
    return true;
  }

  const idsByPlaceholder = new Map(unbound.bindings.map((b) => [b.placeholder, b.ids]));
  const bindingByName = new Map((result.parameters ?? []).map((b) => [b.name, b]));
  // Same lexer reading as bindPreparedQuery and the tenant substitution above.
  const occurrences = scanPlaceholders(ctx.namedSql, ctx.dialectSpec);
  const occurrenceCount = new Map<string, number>();
  for (const occ of occurrences) {
    occurrenceCount.set(occ.name, (occurrenceCount.get(occ.name) ?? 0) + 1);
  }

  const combined: QueryParamSlot[] = [];
  const indexMap = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const occ of occurrences) {
    const tenantIds = idsByPlaceholder.get(occ.placeholder);
    if (tenantIds) {
      combined.push(...tenantIds);
      continue;
    }
    // bindPreparedQuery pushes each occurrence's values contiguously, in source
    // order, so occurrence k of a name owns the k-th equal slice of its indices.
    const binding = bindingByName.get(occ.name);
    const total = occurrenceCount.get(occ.name)!;
    if (!binding || binding.indices.length % total !== 0) return false;
    const per = binding.indices.length / total;
    const k = seen.get(occ.name) ?? 0;
    seen.set(occ.name, k + 1);
    for (const idx of binding.indices.slice(k * per, (k + 1) * per)) {
      if (idx >= business.length || indexMap.has(idx)) return false;
      indexMap.set(idx, combined.length);
      combined.push(business[idx]!);
    }
  }
  if (
    indexMap.size !== business.length ||
    combined.length !== business.length + tenantValues.length
  ) {
    return false;
  }

  result.unboundSql = unbound.sql;
  result.params = combined;
  if (result.parameters) {
    result.parameters = result.parameters.map((b) => ({
      ...b,
      indices: b.indices.map((i) => indexMap.get(i)!),
    }));
  }
  return true;
}

function dropParameterizeExtras(result: AskPipelineResult): void {
  delete result.unboundSql;
  delete result.params;
  delete result.parameters;
  delete result.preparedQuery;
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
    // ask() runs the tenant guardrail itself on the final SQL, so the built-in
    // generator's copy is skipped to avoid a second (pre-substitution) report.
    generate: (question, schema, model, options) =>
      generateSelectSqlWithoutTenantGuardrail(spec, question, schema, model, options),
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
