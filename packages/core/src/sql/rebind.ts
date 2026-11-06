import { QueryParameterError, TenantScopeError, type GuardrailVerdict } from "../errors.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import {
  isTenantPlaceholderName,
  type PreparedQuery,
  type QueryParameterBinding,
  type QueryParameterValue,
  type QueryParamSlot,
} from "./bind.js";
import {
  assertRenderedSql,
  readPreparedQueryDialect,
  renderTemplate,
  renderTenantSql,
  tenantRendering,
} from "./checked-statement.js";
import { isBuiltInDialectId, type BuiltInDialectId, type DialectSpec } from "./dialect-spec.js";
import { enforceGuardrails } from "./guardrails.js";
import type { SensitiveGuardrailMode } from "./sensitive-guardrail.js";
import { findTenantPlaceholderAnyCase, unexpandedSubtreeError, type TenantSqlOutputMode } from "./tenant-placeholders.js";
import { validateTenantScope } from "./tenant-scope-validate.js";

/**
 * The checked rebind (ADR 0010, "Enforcing reuse: re-check at rebind"). It sits above the
 * shared renderer (`checked-statement.ts`), the mechanical renderer (`bind.ts`), tenant
 * substitution (`tenant-placeholders.ts`) and the guardrail checks, which import none of
 * this module.
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
  const spec = readPreparedQueryDialect(prepared, guardrails.dialect);
  const { schema } = guardrails;
  const policy = "schemaId" in schema ? schema.tenantPolicy : undefined;
  const tenant = tenantRendering(policy, guardrails.tenantScope, guardrails.tenantSqlMode, "bindPreparedQuery()");
  rejectTenantValues(values);

  if (policy) {
    // Throws for a missing scope, so `tenant` is set from here on whenever there is a policy.
    validateTenantScope(policy, tenant?.scope);
    const access = tenant!.scope.access;
    if (access.kind === "subtree") throw unexpandedSubtreeError(access.tenantRoot, "bindPreparedQuery()");
  }
  const { verdict } = enforceGuardrails({
    path: "rebind",
    forms: { template: prepared.namedSql },
    dialect: spec,
    schema,
    ...(tenant ? { tenant } : {}),
    sensitiveGuardrailMode: guardrails.sensitiveGuardrailMode,
    acceptWarnings: guardrails.acceptWarnings,
  });

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

  const rendered = renderTemplate(prepared, values, spec, tenant);
  const { unboundSql, params, bindings } = rendered;
  if (!tenant) return { sql: rendered.businessSql, unboundSql, params, bindings, verdict };
  const { sql, tenantParams } = renderTenantSql(rendered.businessSql, spec, tenant);
  // renderTemplate checked its two forms; `sql` is rendered here, so it's checked here.
  assertRenderedSql(sql, spec);
  return { sql, ...(tenantParams ? { tenantParams } : {}), unboundSql, params, bindings, verdict };
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
