import { QueryParameterError, TenantScopeError, type GuardrailVerdict } from "../errors.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import {
  isTenantPlaceholderName,
  markerStyleForDialect,
  renderPreparedQuery,
  scanPlaceholders,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
  type RenderedQuery,
} from "./bind.js";
import { BUILT_IN_DIALECTS, isBuiltInDialectId, type BuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { decide, throwIfDenied } from "./guardrail-decide.js";
import { evaluateGuardrails, guardrailPlan } from "./guardrails.js";
import type { SensitiveGuardrailMode } from "./sensitive-guardrail.js";
import {
  assertTenantSqlMode,
  DEFAULT_TENANT_SQL_MODE,
  findTenantPlaceholderAnyCase,
  resolveTenantSql,
  unexpandedSubtreeError,
  type TenantSqlOutputMode,
} from "./tenant-placeholders.js";
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
  /**
   * The dialect rules to check and render under: the `DialectSpec` `ask()` ran with, or a
   * built-in id. Its `id` must be the template's `dialect`. Required for a template with
   * `dialectRules: "host"`, or one stored without `dialectRules`; a `"builtin"` template
   * defaults to the built-in spec (ADR 0032).
   */
  dialect?: DialectSpec | BuiltInDialectId;
  /**
   * How `sql` carries the tenant IDs, as in `ask()`. The default, `"sql-params"`, keeps the
   * business values inlined and replaces the tenant placeholders with driver markers: run
   * `sql` with `tenantParams`. `"sql-only"` inlines the IDs as escaped literals, and refuses
   * one that isn't printable ASCII or that contains a backslash (`UNESCAPABLE_TENANT_ID`).
   */
  tenantSqlMode?: TenantSqlOutputMode;
};

export type BoundQuery = {
  /**
   * Business values inlined as escaped literals. Tenant IDs are driver markers, run with
   * `tenantParams`, in `"sql-params"` mode (the default), or inlined literals in `"sql-only"`.
   */
  sql: string;
  /**
   * `"sql-params"` mode, with a tenant scope that binds IDs: the tenant IDs for the markers in
   * `sql`, in marker order. `sql` + `tenantParams` is an executable pair on its own.
   */
  tenantParams?: unknown[];
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
 *   placeholder from `guardrails.tenantScope`. In `sql`: driver markers numbered from the
 *   first slot with the IDs in `tenantParams` (`tenantSqlMode: "sql-params"`, the default),
 *   or escaped literals (`"sql-only"`). In `unboundSql`: driver markers after the business
 *   markers (in source order for `?` dialects), with the IDs folded into `params`.
 *   `bindings` lists the business parameters.
 *
 * Throws `QueryParameterError` without `guardrails` (`MISSING_GUARDRAIL_CONTEXT`), for a
 * `:tenant_*` key in `values` (`TENANT_VALUE_SUPPLIED`), and when the tenant markers can't
 * be aligned with the business params (`TENANT_PARAM_ALIGNMENT`). Throws `TenantScopeError`
 * for a missing or invalid scope, an unexpanded `subtree` (`SUBTREE_NOT_RESOLVABLE`), a
 * placeholder the scope has no IDs for, including any placeholder under a `global` scope or
 * a schema without a tenant policy (`UNRESOLVED_TENANT_PLACEHOLDER`), and a tenant ID
 * that isn't printable ASCII or that contains a backslash, which `sql` can't inline safely
 * (`UNESCAPABLE_TENANT_ID`). Synchronous.
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
  const spec = rebindSpec(prepared, guardrails.dialect);
  const tenantMode = guardrails.tenantSqlMode ?? DEFAULT_TENANT_SQL_MODE;
  assertTenantSqlMode(tenantMode, "bindPreparedQuery()");
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

  // A placeholder nothing can render: any one without a policy, or one in another casing.
  // Refused after the decision, as `ask()` refuses it in tenant substitution, so a `deny`
  // keeps its error and verdict; and before binding, so it never binds as a business value.
  const placeholder = findTenantPlaceholderAnyCase(prepared.namedSql, spec);
  if (placeholder !== undefined && (!policy || !isTenantPlaceholderName(placeholder.slice(1)))) {
    throw new TenantScopeError(
      policy
        ? `The template references ${placeholder}, which isn't a tenant placeholder AskDB can render: ` +
            "they are written exactly :tenant_<root>_ids, in lowercase, with nothing glued to the name. " +
            "Refusing to bind an unsubstituted tenant placeholder."
        : `The template references ${placeholder}, but the schema has no tenant policy to render it ` +
            "from. Refusing to bind a template with an unsubstituted tenant placeholder.",
      "UNRESOLVED_TENANT_PLACEHOLDER",
    );
  }

  let bound = renderPreparedQuery(prepared, values, { skipTenantPlaceholders: true, dialect: spec });
  let tenantParams: unknown[] | undefined;
  if (policy && scope) {
    // `sql` carries business values as inlined literals, so its only markers are tenant
    // markers, numbered from the first slot, as in ask() (ADR 0024).
    let sql: string;
    if (tenantMode === "sql-only") {
      sql = inlineTenantIdsForRebind(bound.sql, policy, scope, spec);
    } else {
      const resolved = resolveTenantSql(bound.sql, policy, scope, "sql-params", 1, spec);
      sql = resolved.sql;
      if (resolved.mode === "sql-params" && resolved.params.length > 0) tenantParams = resolved.params;
    }
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
  return { ...bound, ...(tenantParams ? { tenantParams } : {}), verdict };
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

/**
 * In `"sql-only"` mode the rebind's `sql` inlines the tenant IDs. An ID that can't be inlined
 * gets a message that names `bindPreparedQuery()` and points at its own `tenantSqlMode`.
 */
function inlineTenantIdsForRebind(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  spec: DialectSpec,
): string {
  try {
    return resolveTenantSql(sql, policy, scope, "sql-only", 1, spec).sql;
  } catch (error) {
    if (error instanceof TenantScopeError && error.reason === "UNESCAPABLE_TENANT_ID") {
      throw new TenantScopeError(
        "A tenant ID contains a backslash or a character outside printable ASCII, and in tenantSqlMode " +
          "'sql-only' bindPreparedQuery() inlines tenant IDs into the sql it returns: a server whose string " +
          "settings or connection charset differ from the dialect's can read such an ID as the end of the " +
          "literal. Use tenantSqlMode 'sql-params' (the default), which passes it as a driver parameter.",
        "UNESCAPABLE_TENANT_ID",
      );
    }
    throw error;
  }
}

/**
 * The spec a rebind checks and renders under. A `"builtin"` template uses its built-in spec
 * unless the host passes one. A `"host"` template, or one stored without `dialectRules`, has
 * rules AskDB can't recover, so it needs the host's spec rather than a guess (ADR 0032).
 */
function rebindSpec(prepared: PreparedQuery, dialect: BindGuardrails["dialect"]): DialectSpec {
  if (dialect === undefined) {
    if (prepared.dialectRules === "builtin") return BUILT_IN_DIALECTS[prepared.dialect];
    const fix =
      `Pass guardrails.dialect: the DialectSpec ask() ran with, or the built-in id '${prepared.dialect}' ` +
      "if it ran with the built-in rules.";
    const rules = prepared.dialectRules as unknown;
    throw new QueryParameterError(
      rules === "host"
        ? "This template was made by ask() under a host's DialectSpec (dialectRules: 'host'), so " +
            `bindPreparedQuery() checks and renders it only under that spec. ${fix} A constant from another ` +
            "copy of @askdb/core counts as a host's spec."
        : rules === undefined || rules === null
          ? "This template has no dialectRules: it was stored before AskDB recorded which dialect rules ask() " +
              `used, so bindPreparedQuery() won't guess. ${fix}`
          : `This template has dialectRules ${JSON.stringify(rules).replace(/"/g, "'")}, which is neither 'builtin' ` +
              `nor 'host', so bindPreparedQuery() won't guess. ${fix}`,
      "DIALECT_SPEC_REQUIRED",
    );
  }
  const spec = typeof dialect === "string" ? (isBuiltInDialectId(dialect) ? BUILT_IN_DIALECTS[dialect] : undefined) : dialect;
  if (spec?.id !== prepared.dialect) {
    throw new QueryParameterError(
      `guardrails.dialect must have the template's dialect id '${prepared.dialect}'.`,
      "DIALECT_UNSUPPORTED",
    );
  }
  return spec;
}
