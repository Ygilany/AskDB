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
  type GuardrailModes,
  decide,
  formatSensitiveReference,
  sensitiveFindings,
  sensitiveGuardrailResult,
  tenantFindings,
  tenantGuardrailResult,
  tenantWarnings,
  throwIfDenied,
} from "./guardrail-decide.js";
import {
  scanSensitiveReferences,
  schemaHasSensitiveIdentifiers,
  type SensitiveGuardrailMode,
  type SensitiveGuardrailResult,
} from "./sensitive-guardrail.js";
import { tenantRuleWarnings, type TenantGuardrailResult } from "./tenant-guardrail.js";
import { validateSelectSql } from "./validate.js";

/**
 * The enforcement step (ADR 0010, decisions 1–4). `enforceGuardrails()` is the one call
 * each enforcement point makes: `ask()`, `generateSelectSql()` and `bindPreparedQuery()`.
 * It picks the checks and the point from `path`, runs the checks on every form, decides
 * through `decide` (`guardrail-decide.ts`), logs, and throws the typed error on `deny`.
 * The checks below are pure rules: each takes a candidate and returns findings, knows
 * nothing about modes and never throws for a finding. Internal to `@askdb/core`.
 */

type Tenant = { policy: NormalizedTenantPolicy; scope: TenantScope };

/** The untrusted forms an enforcement point checks, before AskDB renders them. */
type Forms = Partial<Record<GuardrailForm, string>>;

/** What an enforcement point hands the step. Fields one point has no use for aren't on its variant. */
export type EnforceInput =
  | {
      path: "ask";
      forms: Forms;
      /** Undefined for a custom `AskDialect`, which may target non-SELECT SQL: no read-only check. */
      dialect: DialectSpec | undefined;
      schema: AnyNormalizedSchema;
      /** A v2 schema's tenant policy, with the (expanded) scope. */
      tenant?: Tenant;
      /** Default `"warn"`. */
      sensitiveGuardrailMode?: SensitiveGuardrailMode | "off";
      /** A custom `AskDialect`'s own tenant result: decided with a tenant policy, passed through without one. */
      generatorTenantGuardrail?: TenantGuardrailResult;
      logger?: AskDbLogger;
    }
  | {
      path: "generate";
      forms: Forms;
      dialect: DialectSpec;
      schema: AnyNormalizedSchema;
      tenant?: Tenant;
      logger?: AskDbLogger;
    }
  | {
      path: "rebind";
      forms: { template: string };
      dialect: DialectSpec;
      schema: AnyNormalizedSchema;
      tenant?: Tenant;
      sensitiveGuardrailMode?: SensitiveGuardrailMode | "off";
      acceptWarnings?: ReadonlyArray<"tenant">;
    };

/** A verdict the point may hand back (`allow` or `warn`), with the results derived from it. */
export type Enforced = {
  verdict: GuardrailVerdict;
  /** With a tenant policy, derived from the verdict. Without one (`ask` only), a custom generator's result as reported. */
  tenantGuardrail?: TenantGuardrailResult;
  /** Present when the sensitive check ran. */
  sensitiveGuardrail?: SensitiveGuardrailResult;
};

/**
 * Run the path's checks on every form, decide, log, and on `deny` throw the typed error
 * with the verdict attached (`SqlValidationError`, then `TenantGuardrailError`, then
 * `SensitiveReferenceError`). `ask` and `generate` decide at the `return` point and log
 * with their logger: the tenant pass/fail event, the sensitive references, and
 * `pipeline.failed` on a deny. `rebind` decides at the `rebind` point and logs nothing.
 */
export function enforceGuardrails(input: EnforceInput): Enforced {
  const { checks, modes } = guardrailPlan(input);
  const findings = evaluateGuardrails(
    {
      forms: input.forms,
      dialect: input.dialect,
      schema: input.schema,
      ...(input.tenant ? { tenant: input.tenant } : {}),
    },
    checks,
  );
  if (input.path === "ask" && input.tenant) findings.push(...generatorFindings(input.generatorTenantGuardrail));
  const point = input.path === "rebind" ? "rebind" : "return";
  const verdict = decide(findings, modes, point);
  const sensitiveChecked = checks.includes("sensitive");
  const logger = input.path === "rebind" ? undefined : input.logger;
  logGuardrailVerdict(logger, verdict, { tenantPolicy: input.tenant?.policy, sensitiveChecked });
  try {
    throwIfDenied(verdict, modes, point);
  } catch (e) {
    logger?.error(
      { event: AskDbLogEvent.PipelineFailed, phase: "generate", errMessage: (e as Error).message },
      "nl-to-sql generate failed",
    );
    throw e;
  }

  const enforced: Enforced = { verdict };
  if (input.tenant) {
    enforced.tenantGuardrail = tenantGuardrailResult(findings);
  } else if (input.path === "ask" && input.generatorTenantGuardrail !== undefined) {
    // Without a tenant policy there is no mode to decide with: pass through what a custom
    // dialect reported.
    enforced.tenantGuardrail = input.generatorTenantGuardrail;
  }
  if (sensitiveChecked) enforced.sensitiveGuardrail = sensitiveGuardrailResult(findings);
  return enforced;
}

/** What every check reads: the forms and the context they're checked in. */
type Candidate = {
  /** `sql`: the model's bound SQL. `template`: its `sql-unbound` block (`preparedQuery.namedSql`). */
  forms: Forms;
  /** Undefined for a custom `AskDialect`. */
  dialect: DialectSpec | undefined;
  schema: AnyNormalizedSchema;
  tenant?: Tenant;
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

/**
 * ADR 0010, decision 3: which checks each enforcement point runs, and the modes `decide`
 * reads there. `ask()` with a custom `AskDialect` has no `dialect`, so no read-only check;
 * `generateSelectSql()` takes no sensitive mode, so no sensitive check; `acceptWarnings`
 * means something at rebind only.
 */
function guardrailPlan(input: EnforceInput): { checks: GuardrailCheckId[]; modes: GuardrailModes } {
  const sensitive = input.path === "generate" ? "off" : (input.sensitiveGuardrailMode ?? "warn");
  const policy = input.tenant?.policy;
  const checks: GuardrailCheckId[] = [];
  if (input.dialect) checks.push("read-only");
  if (policy) checks.push("tenant");
  if (sensitive !== "off" && schemaHasSensitiveIdentifiers(input.schema)) checks.push("sensitive");
  return {
    checks,
    modes: {
      ...(policy ? { tenant: policy.enforcement } : {}),
      sensitive,
      ...(input.path === "rebind" && input.acceptWarnings ? { acceptWarnings: input.acceptWarnings } : {}),
    },
  };
}

/** Run each listed check on every form in the candidate. */
function evaluateGuardrails(
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
 * A custom `AskDialect`'s reported tenant result as findings, so `decide` rules on it under
 * the policy's mode. A failure it reports without details becomes one `UNPROVABLE_SCOPE`.
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

/**
 * Log a verdict the way `ask()` and `generateSelectSql()` always have: one tenant
 * pass/fail event (with a tenant policy), and the sensitive references (when checked).
 */
function logGuardrailVerdict(
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
