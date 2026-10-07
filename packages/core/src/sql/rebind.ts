import { QueryParameterError, TenantScopeError, type GuardrailVerdict } from "../errors.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import {
  markerStyleForDialect,
  renderPreparedQuery,
  scanPlaceholders,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
  type RenderedQuery,
} from "./bind.js";
import { BUILT_IN_DIALECTS, isBuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { decide, throwIfDenied } from "./guardrail-decide.js";
import { evaluateGuardrails, guardrailPlan } from "./guardrails.js";
import type { SensitiveGuardrailMode } from "./sensitive-guardrail.js";
import { findTenantPlaceholderAnyCase, resolveTenantSql, unexpandedSubtreeError } from "./tenant-placeholders.js";
import { validateTenantScope } from "./tenant-scope-validate.js";
import { validateSelectSql } from "./validate.js";

/**
 * The checked rebind (ADR 0010, "Enforcing reuse: re-check at rebind"). It sits above the
 * mechanical renderer (`bind.ts`), tenant substitution (`tenant-placeholders.ts`) and the
 * guardrail checks, which import none of this module.
 */

/** The guardrail context `bindPreparedQuery()` checks the template under. Required. */
export type BindGuardrails = {
  /** The schema the template is checked against: its tenant policy and its sensitive markers. */
  schema: AnyNormalizedSchema;
  /**
   * The caller's tenant scope, as in `ask()`. Required when the schema has a tenant policy.
   * Tenant IDs are rendered from it, never from `values`. A `subtree` scope must arrive
   * expanded: pass it through `expandTenantScope()` first.
   */
  tenantScope?: TenantScope;
  /** As in `ask()`: default `"warn"` reports sensitive references in the verdict, `"strict"` refuses them. */
  sensitiveGuardrailMode?: SensitiveGuardrailMode | "off";
  /**
   * Checks whose `warn` the caller accepts at rebind. A tenant warning (a policy with
   * `enforcement: warn`) is refused unless this includes `"tenant"`.
   */
  acceptWarnings?: ReadonlyArray<"tenant">;
};

export type BoundQuery = {
  /** Ready to run as-is: business values and tenant IDs inlined as escaped literals. */
  sql: string;
  /** The same statement with driver markers instead of literals; run it with `params`. */
  unboundSql: string;
  /** Values for `unboundSql`, in marker order, tenant IDs included. */
  params: QueryParamSlot[];
  /** The business parameters as bound, with the `params` indices they fill. */
  bindings: QueryParameterBinding[];
  /** The guardrail verdict for the template under the bind-time schema, scope and modes. */
  verdict: GuardrailVerdict;
};

type Values = Record<string, QueryParameterValue | readonly QueryParameterValue[]>;

/**
 * Bind new values into a stored `PreparedQuery` without calling the model, after
 * re-checking the template under the schema, tenant scope and modes given now.
 *
 * - Runs the read-only, tenant (with a tenant policy) and sensitive (unless `"off"`)
 *   checks on `prepared.namedSql`. A failure throws the check's typed error, with the
 *   precedence `SqlValidationError`, `TenantGuardrailError`, `SensitiveReferenceError`
 *   and the verdict attached. A tenant `warn` is refused unless
 *   `guardrails.acceptWarnings` includes `"tenant"`; a sensitive `warn` binds and is
 *   reported in `verdict`.
 * - Binds the business values from `values`, then renders each `:tenant_<root>_ids`
 *   placeholder from `guardrails.tenantScope`: escaped literals in `sql`, driver markers
 *   after the business markers in `unboundSql` (in source order for `?` dialects), with
 *   the IDs folded into `params`. `bindings` lists the business parameters.
 *
 * Throws `QueryParameterError` without `guardrails` (`MISSING_GUARDRAIL_CONTEXT`), for a
 * `:tenant_*` key in `values` (`TENANT_VALUE_SUPPLIED`), and when the tenant markers can't
 * be aligned with the business params (`TENANT_PARAM_ALIGNMENT`). Throws `TenantScopeError`
 * for a missing or invalid scope, an unexpanded `subtree` (`SUBTREE_NOT_RESOLVABLE`), and a
 * placeholder the scope has no IDs for, including any placeholder under a `global` scope or
 * a schema without a tenant policy (`UNRESOLVED_TENANT_PLACEHOLDER`). Synchronous.
 */
export function bindPreparedQuery(prepared: PreparedQuery, values: Values, guardrails: BindGuardrails): BoundQuery {
  if (typeof guardrails !== "object" || guardrails === null || guardrails.schema === undefined) {
    throw new QueryParameterError(
      "bindPreparedQuery() needs a third argument, { schema, tenantScope?, sensitiveGuardrailMode?, " +
        "acceptWarnings? }: it re-checks the template under that schema and scope before binding.",
      "MISSING_GUARDRAIL_CONTEXT",
    );
  }
  if (!isBuiltInDialectId(prepared.dialect)) {
    throw new QueryParameterError(`Unknown dialect '${prepared.dialect}'.`, "DIALECT_UNSUPPORTED");
  }
  const spec = BUILT_IN_DIALECTS[prepared.dialect];
  rejectTenantValues(values);

  const { schema } = guardrails;
  const policy = "schemaId" in schema ? schema.tenantPolicy : undefined;
  let scope: TenantScope | undefined;
  if (policy) {
    validateTenantScope(policy, guardrails.tenantScope);
    scope = guardrails.tenantScope!;
    if (scope.access.kind === "subtree") {
      throw unexpandedSubtreeError(scope.access.tenantRoot, "bindPreparedQuery()");
    }
  }
  // A placeholder nothing can render: any one without a policy, or one in another casing.
  const placeholder = findTenantPlaceholderAnyCase(prepared.namedSql, spec);
  if (placeholder !== undefined && (!policy || placeholder !== placeholder.toLowerCase())) {
    throw new TenantScopeError(
      policy
        ? `The template references ${placeholder}, but tenant placeholders are case-sensitive and must ` +
            `be written ${placeholder.toLowerCase()}. Refusing to bind an unsubstituted tenant placeholder.`
        : `The template references ${placeholder}, but the schema has no tenant policy to render it ` +
            "from. Refusing to bind a template with an unsubstituted tenant placeholder.",
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
  }

  const { checks, modes } = guardrailPlan("rebind", {
    dialect: spec,
    schema,
    tenantPolicy: policy,
    sensitiveGuardrailMode: guardrails.sensitiveGuardrailMode,
    acceptWarnings: guardrails.acceptWarnings,
  });
  const findings = evaluateGuardrails(
    {
      forms: { template: prepared.namedSql },
      dialect: spec,
      schema,
      ...(policy && scope ? { tenant: { policy, scope } } : {}),
    },
    checks,
  );
  const verdict = decide(findings, modes, "rebind");
  throwIfDenied(verdict, modes, "rebind");

  let bound = renderPreparedQuery(prepared, values, { skipTenantPlaceholders: true });
  if (policy && scope) {
    const sql = resolveTenantSql(bound.sql, policy, scope, "sql-only", 1, spec).sql;
    const unbound = bindTenantIntoUnboundSql(bound, {
      namedSql: prepared.namedSql,
      tenantPolicy: policy,
      tenantScope: scope,
      dialectSpec: spec,
    });
    if (!unbound) {
      throw new QueryParameterError(
        "The template's tenant markers can't be aligned with its business parameters in unboundSql.",
        "TENANT_PARAM_ALIGNMENT",
      );
    }
    bound = { ...unbound, sql };
  }

  // Rendering only swaps placeholders (ADR 0010, decision 0); these assert that contract.
  if (scanPlaceholders(bound.sql, spec).length > 0 || scanPlaceholders(bound.unboundSql, spec).length > 0) {
    throw new QueryParameterError("One or more placeholders remain after binding.", "UNRESOLVED_PLACEHOLDER");
  }
  validateSelectSql(spec, bound.sql);
  validateSelectSql(spec, bound.unboundSql);
  return { ...bound, verdict };
}

function rejectTenantValues(values: Values): void {
  for (const key of Object.keys(values ?? {})) {
    if (!/^:?tenant_[a-z0-9_]+_ids$/i.test(key)) continue;
    throw new QueryParameterError(
      `values has the tenant key '${key}'. Tenant IDs come from guardrails.tenantScope, not from values.`,
      "TENANT_VALUE_SUPPLIED",
    );
  }
}

/**
 * Substitute tenant placeholders in a rendered `unboundSql` (business markers bound,
 * `:tenant_*` placeholders still in place) with driver markers, and fold their values into
 * `params`, so `unboundSql` + `params` is a single executable pair. Shared by `ask()`
 * (`tenantSqlMode: "sql-params"`) and `bindPreparedQuery()`.
 *
 * - `$N` / `@pN` dialects: markers are explicitly numbered, so tenant markers continue
 *   after the business slots and tenant values are appended.
 * - `?` dialects: markers are positional, so `params` must follow source order. Business
 *   and tenant values are interleaved by walking the named template in order, and
 *   `bindings[].indices` are remapped to the new positions.
 *
 * Returns undefined when the business binding and the tenant substitution disagree about
 * the statement's shape, rather than misaligned params.
 */
export function bindTenantIntoUnboundSql(
  bound: Pick<RenderedQuery, "unboundSql" | "params" | "bindings">,
  ctx: {
    /** The template, with business and tenant placeholders. */
    namedSql: string;
    tenantPolicy: NormalizedTenantPolicy;
    tenantScope: TenantScope;
    dialectSpec: DialectSpec | undefined;
  },
): Pick<RenderedQuery, "unboundSql" | "params" | "bindings"> | undefined {
  const business = bound.params;
  const unbound = resolveTenantSql(
    bound.unboundSql,
    ctx.tenantPolicy,
    ctx.tenantScope,
    "sql-params",
    business.length + 1,
    ctx.dialectSpec,
  );
  if (unbound.mode !== "sql-params") return undefined;
  const tenantValues = unbound.params as QueryParamSlot[];

  const dialectId = ctx.dialectSpec?.id;
  const style =
    dialectId !== undefined && isBuiltInDialectId(dialectId) ? markerStyleForDialect(dialectId) : "dollar";
  if (style !== "question") {
    return { unboundSql: unbound.sql, params: [...business, ...tenantValues], bindings: bound.bindings };
  }

  const idsByPlaceholder = new Map(unbound.bindings.map((b) => [b.placeholder, b.ids]));
  const bindingByName = new Map(bound.bindings.map((b) => [b.name, b]));
  // Same lexer reading as the renderer and the tenant substitution above.
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
    // The renderer pushes each occurrence's values contiguously, in source order, so
    // occurrence k of a name owns the k-th equal slice of its indices.
    const binding = bindingByName.get(occ.name);
    const total = occurrenceCount.get(occ.name)!;
    if (!binding || binding.indices.length % total !== 0) return undefined;
    const per = binding.indices.length / total;
    const k = seen.get(occ.name) ?? 0;
    seen.set(occ.name, k + 1);
    for (const idx of binding.indices.slice(k * per, (k + 1) * per)) {
      if (idx >= business.length || indexMap.has(idx)) return undefined;
      indexMap.set(idx, combined.length);
      combined.push(business[idx]!);
    }
  }
  if (indexMap.size !== business.length || combined.length !== business.length + tenantValues.length) {
    return undefined;
  }

  const bindings: QueryParameterBinding[] = bound.bindings.map((b) => ({
    ...b,
    indices: b.indices.map((i) => indexMap.get(i)!),
  }));
  return { unboundSql: unbound.sql, params: combined, bindings };
}
