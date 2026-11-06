import { QueryParameterError } from "../errors.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import {
  isTenantPlaceholderName,
  markerStyleForDialect,
  renderPreparedQuery,
  scanPlaceholders,
  scanTenantPlaceholders,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
  type RenderedQuery,
} from "./bind.js";
import { BUILT_IN_DIALECTS, isBuiltInDialectId, type BuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import type { ParameterManifest } from "./parameter-manifest.js";
import {
  assertTenantSqlMode,
  DEFAULT_TENANT_SQL_MODE,
  resolveTenantSql,
  type TenantBinding,
  type TenantSqlOutputMode,
} from "./tenant-placeholders.js";
import { validateSelectSql } from "./validate.js";

/**
 * One renderer for a checked statement (ADR 0010): the template `ask()` stores, and the forms
 * `ask()` and `bindPreparedQuery()` render from a template or a model's SQL. Both callers run
 * their guardrails on the unrendered forms first; rendering here only swaps placeholders for
 * literals or driver markers, and refuses a result that does more. Internal to `@askdb/core`:
 * it sits above the mechanical renderer (`bind.ts`) and tenant substitution, and below
 * `ask.ts` and `rebind.ts`.
 */

/** The template `ask()` stores (PreparedQuery v1), with `dialectRules` set from the spec it ran under. */
export function writePreparedQuery(namedSql: string, manifest: ParameterManifest, dialect: DialectSpec): PreparedQuery {
  return {
    version: 1,
    dialect: dialect.id as BuiltInDialectId,
    dialectRules: dialect === BUILT_IN_DIALECTS[dialect.id as BuiltInDialectId] ? "builtin" : "host",
    namedSql,
    parameters: [
      ...manifest.parameters.map((p) => ({
        name: p.name,
        placeholder: `:${p.name}`,
        type: p.type,
        cardinality: p.cardinality,
        description: p.description,
        source: "question" as const,
      })),
      ...tenantDecls(namedSql, dialect),
    ],
  };
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

/**
 * The spec a stored template renders under (ADR 0032). A `"builtin"` template uses its built-in
 * spec unless the host passes one. A `"host"` template, or one stored without `dialectRules`,
 * has rules AskDB can't recover, so it needs the host's spec rather than a guess. Throws
 * `QueryParameterError`: `DIALECT_SPEC_REQUIRED` without the spec it needs,
 * `DIALECT_UNSUPPORTED` for a spec whose id isn't the template's dialect.
 */
export function readPreparedQueryDialect(prepared: PreparedQuery, dialect?: DialectSpec | BuiltInDialectId): DialectSpec {
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

/** Where a caller's tenant IDs come from (the policy and the expanded scope) and how `sql` carries them. */
export type TenantRendering = {
  policy: NormalizedTenantPolicy;
  scope: TenantScope;
  mode: TenantSqlOutputMode;
};

/**
 * `tenantSqlMode` defaulted (`DEFAULT_TENANT_SQL_MODE`) and checked once, for `caller`: a mode
 * that is neither `"sql-params"` nor `"sql-only"` throws `TenantScopeError`
 * (`TENANT_SQL_MODE_REQUIRED`), with or without a policy. Returns undefined without a policy or
 * a scope: nothing renders tenant IDs then. The caller validates the scope.
 */
export function tenantRendering(
  policy: NormalizedTenantPolicy | undefined,
  scope: TenantScope | undefined,
  mode: unknown,
  caller: string,
): TenantRendering | undefined {
  const resolved = mode ?? DEFAULT_TENANT_SQL_MODE;
  assertTenantSqlMode(resolved, caller);
  return policy && scope ? { policy, scope, mode: resolved } : undefined;
}

/** Both forms of a checked template, as {@link renderTemplate} renders them. */
export type RenderedTemplate = {
  /** Business values inlined as escaped literals; the `:tenant_<root>_ids` placeholders still in place. */
  businessSql: string;
  /** Every value a driver marker, tenant IDs included whatever the mode. Run it with `params`. */
  unboundSql: string;
  /** Values for `unboundSql`, in marker order: source order on `?` dialects, tenant IDs last otherwise. */
  params: QueryParamSlot[];
  /** The business parameters as bound, with the `params` indices they fill. */
  bindings: QueryParameterBinding[];
};

/**
 * Both forms of a checked template. Binds the business values from `values`, then, with a
 * tenant rendering, the tenant IDs into `unboundSql` as driver markers (`unboundSql` always
 * binds them; `tenant.mode` governs only the bound form, through {@link renderTenantSql}).
 *
 * Then asserts that rendering only swapped placeholders (ADR 0010, decision 0): no
 * placeholder is left in either form, except the tenant placeholders `businessSql` keeps for
 * {@link renderTenantSql}, and both forms pass `validateSelectSql`.
 *
 * Throws on any failure: the renderer's `QueryParameterError` (with its reason), a
 * `TenantScopeError` from tenant substitution, `QueryParameterError` with
 * `UNRESOLVED_PLACEHOLDER` for a leftover placeholder or `TENANT_PARAM_ALIGNMENT` when the
 * tenant markers can't be aligned with the business params, and `SqlValidationError` from
 * the read-only check.
 */
export function renderTemplate(
  prepared: PreparedQuery,
  values: Record<string, QueryParameterValue | readonly QueryParameterValue[]>,
  dialect: DialectSpec,
  tenant?: TenantRendering,
): RenderedTemplate {
  const business = renderPreparedQuery(prepared, values, { skipTenantPlaceholders: true, dialect });
  const unbound = tenant ? bindTenantIntoUnboundSql(business, prepared.namedSql, tenant, dialect) : business;
  if (!unbound) {
    throw new QueryParameterError(
      "The template's tenant markers can't be aligned with its business parameters in unboundSql.",
      "TENANT_PARAM_ALIGNMENT",
    );
  }
  assertRenderedSql(business.sql, dialect, tenant !== undefined);
  assertRenderedSql(unbound.unboundSql, dialect);
  return { businessSql: business.sql, unboundSql: unbound.unboundSql, params: unbound.params, bindings: unbound.bindings };
}

/**
 * Assert a rendered form holds no placeholder (`QueryParameterError`,
 * `UNRESOLVED_PLACEHOLDER`), apart from tenant placeholders when `keepTenantPlaceholders`
 * says a later step renders them, and passes `validateSelectSql` (`SqlValidationError`).
 */
export function assertRenderedSql(sql: string, dialect: DialectSpec, keepTenantPlaceholders = false): void {
  const left = scanPlaceholders(sql, dialect).filter((p) => !(keepTenantPlaceholders && isTenantPlaceholderName(p.name)));
  if (left.length > 0) {
    throw new QueryParameterError("One or more placeholders remain after binding.", "UNRESOLVED_PLACEHOLDER");
  }
  validateSelectSql(dialect, sql);
}

/**
 * A statement's tenant placeholders rendered from `tenant`: driver markers numbered from the
 * first slot, with the IDs in `tenantParams` (`"sql-params"`), or escaped literals
 * (`"sql-only"`). `sql`'s business values are already literals, so its only markers are
 * tenant markers: `sql` + `tenantParams` is an executable pair on its own (ADR 0024).
 * `dialect` is undefined for a custom `AskDialect`, which gets `$N` markers. Throws what
 * `resolveTenantSql()` throws (`TenantScopeError`, `SchemaParseError`).
 */
export function renderTenantSql(
  sql: string,
  dialect: DialectSpec | undefined,
  tenant: TenantRendering,
): { sql: string; tenantParams?: unknown[]; tenantBindings: TenantBinding[] } {
  const resolved = resolveTenantSql(sql, tenant.policy, tenant.scope, tenant.mode, 1, dialect);
  const tenantParams = resolved.mode === "sql-params" && resolved.params.length > 0 ? resolved.params : undefined;
  return { sql: resolved.sql, ...(tenantParams ? { tenantParams } : {}), tenantBindings: resolved.bindings };
}

/**
 * Substitute tenant placeholders in a rendered `unboundSql` (business markers bound,
 * `:tenant_*` placeholders still in place) with driver markers, and fold their values into
 * `params`, so `unboundSql` + `params` is a single executable pair.
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
function bindTenantIntoUnboundSql(
  bound: Pick<RenderedQuery, "unboundSql" | "params" | "bindings">,
  /** The template, with business and tenant placeholders. */
  namedSql: string,
  tenant: TenantRendering,
  dialect: DialectSpec,
): Pick<RenderedQuery, "unboundSql" | "params" | "bindings"> | undefined {
  const business = bound.params;
  const unbound = resolveTenantSql(bound.unboundSql, tenant.policy, tenant.scope, "sql-params", business.length + 1, dialect);
  if (unbound.mode !== "sql-params") return undefined;
  const tenantValues = unbound.params as QueryParamSlot[];

  const style = isBuiltInDialectId(dialect.id) ? markerStyleForDialect(dialect.id) : "dollar";
  if (style !== "question") {
    return { unboundSql: unbound.sql, params: [...business, ...tenantValues], bindings: bound.bindings };
  }

  const idsByPlaceholder = new Map(unbound.bindings.map((b) => [b.placeholder, b.ids]));
  const bindingByName = new Map(bound.bindings.map((b) => [b.name, b]));
  // Same lexer reading as the renderer and the tenant substitution above.
  const occurrences = scanPlaceholders(namedSql, dialect);
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
