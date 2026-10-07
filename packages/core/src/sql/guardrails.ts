import {
  SqlValidationError,
  type GuardrailCheckId,
  type GuardrailFinding,
  type GuardrailForm,
  type GuardrailVerdict,
} from "../errors.js";
import type { AskDbLogger } from "../logging/askdb-logger.js";
import { AskDbLogEvent } from "../logging/log-events.js";
import type { AnyNormalizedSchema } from "../schema/types.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import type { DialectSpec } from "./dialect-spec.js";
import {
  formatSensitiveReference,
  sensitiveFindings,
  sensitiveGuardrailResult,
  tenantFindings,
  tenantWarnings,
} from "./guardrail-decide.js";
import { scanSensitiveReferences } from "./sensitive-guardrail.js";
import { tenantRuleWarnings } from "./tenant-guardrail.js";
import { validateSelectSql } from "./validate.js";

/**
 * The checks as pure rules (ADR 0010, decision 1): each takes a candidate and returns
 * findings. They know nothing about modes and never throw for a finding; `decide`
 * (`guardrail-decide.ts`) maps the findings to a verdict. Internal to `@askdb/core`.
 */

/** What every enforcement point checks: the untrusted forms, before AskDB renders them. */
export type Candidate = {
  /** `sql`: the model's bound SQL. `template`: its `sql-unbound` block (`preparedQuery.namedSql`). */
  forms: Partial<Record<GuardrailForm, string>>;
  /** Undefined for a custom `AskDialect`. */
  dialect: DialectSpec | undefined;
  schema: AnyNormalizedSchema;
  /** A v2 schema's tenant policy, with the enforcement point's (expanded) scope. */
  tenant?: { policy: NormalizedTenantPolicy; scope: TenantScope };
};

type GuardrailCheck = (candidate: Candidate, form: GuardrailForm, sql: string) => GuardrailFinding[];

const CHECKS: Record<GuardrailCheckId, GuardrailCheck> = {
  // Needs a DialectSpec: a custom AskDialect may target non-SELECT SQL (decision 3).
  "read-only": ({ dialect }, form, sql) => {
    if (!dialect) return [];
    try {
      validateSelectSql(dialect, sql);
      return [];
    } catch (error) {
      if (!(error instanceof SqlValidationError)) throw error;
      return [
        {
          check: "read-only",
          form,
          rule: error.rule,
          message: error.message,
          ...(error.hint !== undefined ? { hint: error.hint } : {}),
        },
      ];
    }
  },
  tenant: ({ tenant, dialect }, form, sql) =>
    tenant ? tenantFindings(tenantRuleWarnings(sql, tenant.policy, tenant.scope, dialect), form) : [],
  sensitive: ({ schema, dialect }, form, sql) =>
    sensitiveFindings(scanSensitiveReferences(sql, schema, dialect), form),
};

const FORMS: readonly GuardrailForm[] = ["sql", "template"];

/** Run each listed check on every form in the candidate. */
export function evaluateGuardrails(
  candidate: Candidate,
  checks: readonly GuardrailCheckId[],
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  for (const check of checks) {
    for (const form of FORMS) {
      const sql = candidate.forms[form];
      if (sql !== undefined) findings.push(...CHECKS[check](candidate, form, sql));
    }
  }
  return findings;
}

/**
 * Log a verdict the way `ask()` and `generateSelectSql()` always have: one tenant
 * pass/fail event (with a tenant policy), and the sensitive references (when checked).
 */
export function logGuardrailVerdict(
  logger: AskDbLogger | undefined,
  verdict: GuardrailVerdict,
  context: { tenantPolicy: NormalizedTenantPolicy | undefined; sensitiveChecked: boolean },
): void {
  if (context.tenantPolicy) {
    const warnings = tenantWarnings(verdict.findings);
    if (warnings.length === 0) {
      logger?.info({ event: AskDbLogEvent.TenantGuardrailPassed }, "tenant guardrail validation passed");
    } else {
      logger?.info(
        {
          event: AskDbLogEvent.TenantGuardrailFailed,
          warningCount: warnings.length,
          enforcement: context.tenantPolicy.enforcement,
        },
        "tenant guardrail validation found issues",
      );
    }
  }
  if (!context.sensitiveChecked) return;
  const references = sensitiveGuardrailResult(verdict.findings).references;
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
