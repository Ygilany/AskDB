import {
  SensitiveReferenceError,
  SqlValidationError,
  TenantGuardrailError,
  type GuardrailCheckId,
  type GuardrailFinding,
  type GuardrailForm,
  type GuardrailOutcome,
  type GuardrailVerdict,
  type SensitiveReference,
  type SensitiveReferenceRuleCode,
  type SensitiveScopeReport,
  type TenantGuardrailWarning,
} from "../errors.js";

/**
 * The decision point (ADR 0010, decision 2): the only code that knows what `strict`,
 * `warn` and `off` mean, at each enforcement point. A leaf module: the checks and the
 * enforcement points import it, and it imports only the error vocabulary.
 */

/** `return`: `ask()` / `generateSelectSql()` handing SQL back. `rebind`: `bindPreparedQuery()`. */
export type GuardrailPoint = "return" | "rebind";

export type GuardrailModes = {
  /** The tenant policy's `enforcement`; absent without a policy. */
  tenant?: "warn" | "strict";
  /** The caller's `sensitiveGuardrailMode`, default `"warn"`. With `"off"` the check doesn't run. */
  sensitive: "off" | "warn" | "strict";
  /** Rebind only: checks whose `warn` the caller accepts. */
  acceptWarnings?: ReadonlyArray<"tenant">;
};

const SEVERITY: Record<GuardrailOutcome, number> = { allow: 0, warn: 1, deny: 2 };

/**
 * Map findings to a verdict. Read-only findings always deny. Tenant findings deny under
 * `strict`; under `warn` they warn when returned, and deny at rebind unless the caller
 * lists `"tenant"` in `acceptWarnings`. Sensitive findings deny under `strict` and warn
 * otherwise, at both points. The outcome is the most severe finding's.
 */
export function decide(
  findings: GuardrailFinding[],
  modes: GuardrailModes,
  point: GuardrailPoint,
): GuardrailVerdict {
  let outcome: GuardrailOutcome = "allow";
  for (const finding of findings) {
    const o = outcomeOf(finding.check, modes, point);
    if (SEVERITY[o] > SEVERITY[outcome]) outcome = o;
  }
  return { outcome, findings };
}

function outcomeOf(check: GuardrailCheckId, modes: GuardrailModes, point: GuardrailPoint): GuardrailOutcome {
  switch (check) {
    case "read-only":
      return "deny";
    case "tenant":
      // No mode can only mean a finding without a policy: fail closed.
      if (modes.tenant !== "warn") return "deny";
      if (point === "rebind" && !modes.acceptWarnings?.includes("tenant")) return "deny";
      return "warn";
    case "sensitive":
      return modes.sensitive === "strict" ? "deny" : modes.sensitive === "warn" ? "warn" : "allow";
  }
}

/**
 * Throw the typed error for a `deny` verdict, with the verdict attached. When several
 * checks deny, the precedence is read-only (`SqlValidationError`), then tenant
 * (`TenantGuardrailError`), then sensitive (`SensitiveReferenceError`).
 */
export function throwIfDenied(verdict: GuardrailVerdict, modes: GuardrailModes, point: GuardrailPoint): void {
  if (verdict.outcome !== "deny") return;
  const denied = (check: GuardrailCheckId) =>
    verdict.findings.filter((f) => f.check === check && outcomeOf(check, modes, point) === "deny");

  let error: SqlValidationError | TenantGuardrailError | SensitiveReferenceError;
  const readOnly = denied("read-only");
  const tenant = denied("tenant");
  if (readOnly.length > 0) {
    const first = readOnly[0] as Extract<GuardrailFinding, { check: "read-only" }>;
    error = new SqlValidationError(first.message, first.rule, first.hint);
  } else if (tenant.length > 0) {
    const warnings = tenantWarnings(tenant);
    const detail = warnings.map((w) => w.message).join("; ");
    error = new TenantGuardrailError(
      modes.tenant === "warn"
        ? "Tenant guardrail found issues (policy enforcement: warn), and bindPreparedQuery() refuses a " +
            `tenant warning unless acceptWarnings includes "tenant": ${detail}`
        : `Tenant guardrail validation failed (strict mode): ${detail}`,
      warnings,
    );
  } else {
    const result = sensitiveGuardrailResult(denied("sensitive"));
    error = new SensitiveReferenceError(
      sensitiveStrictMessage(result),
      sensitiveRuleFor(result),
      result.references,
      result.unresolvedScope,
    );
  }
  error.verdict = verdict;
  throw error;
}

// ---------------------------------------------------------------------------
// Tenant findings ↔ the TenantGuardrailResult shape
// ---------------------------------------------------------------------------

/** Tenant findings for one form, from the rule's warnings. */
export function tenantFindings(
  warnings: readonly TenantGuardrailWarning[],
  form: GuardrailForm | "generator",
): GuardrailFinding[] {
  return warnings.map((w) => ({ check: "tenant", form, rule: w.rule, message: w.message, tableId: w.tableId }));
}

/** The tenant findings as warnings, once each across forms (same rule, table and message). */
export function tenantWarnings(findings: readonly GuardrailFinding[]): TenantGuardrailWarning[] {
  const seen = new Set<string>();
  const out: TenantGuardrailWarning[] = [];
  for (const f of findings) {
    if (f.check !== "tenant") continue;
    const key = `${f.rule}\u0000${f.tableId}\u0000${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rule: f.rule, tableId: f.tableId, message: f.message });
  }
  return out;
}

/** `result.tenantGuardrail`, derived from the verdict. */
export function tenantGuardrailResult(findings: readonly GuardrailFinding[]): {
  passed: boolean;
  warnings: TenantGuardrailWarning[];
} {
  const warnings = tenantWarnings(findings);
  return { passed: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Sensitive findings ↔ the SensitiveGuardrailResult shape
// ---------------------------------------------------------------------------

type SensitiveScan = { references: SensitiveReference[]; unresolvedScope?: SensitiveScopeReport };

/** Render a reference as `schema.table.column` (or `table.column` when the schema has no namespace). */
export function formatSensitiveReference(ref: SensitiveReference): string {
  const table = ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
  return `${table}.${ref.column}`;
}

/** Sensitive findings for one form: one per reference, plus one when the scope wasn't resolved. */
export function sensitiveFindings(scan: SensitiveScan, form: GuardrailForm): GuardrailFinding[] {
  const findings: GuardrailFinding[] = scan.references.map((reference) => {
    const table = reference.matchKind === "table";
    return {
      check: "sensitive",
      form,
      rule: table ? "SENSITIVE_TABLE_REFERENCED" : "SENSITIVE_COLUMN_REFERENCED",
      message: table
        ? `SQL references sensitive table ${formatSensitiveReference(reference).replace(/\.\*$/, "")}`
        : `SQL references sensitive column ${formatSensitiveReference(reference)}`,
      reference,
    };
  });
  if (scan.unresolvedScope) {
    findings.push({
      check: "sensitive",
      form,
      rule: "UNRESOLVED_TABLE_SCOPE",
      message: scan.unresolvedScope.message,
      unresolvedScope: scan.unresolvedScope,
    });
  }
  return findings;
}

/** `result.sensitiveGuardrail`, derived from the verdict: references once each across forms. */
export function sensitiveGuardrailResult(findings: readonly GuardrailFinding[]): {
  passed: boolean;
  references: SensitiveReference[];
  unresolvedScope?: SensitiveScopeReport;
} {
  const references: SensitiveReference[] = [];
  const seen = new Set<string>();
  let unresolvedScope: SensitiveScopeReport | undefined;
  let any = false;
  for (const f of findings) {
    if (f.check !== "sensitive") continue;
    any = true;
    if (f.unresolvedScope) unresolvedScope ??= f.unresolvedScope;
    if (!f.reference) continue;
    const r = f.reference;
    const key = `${r.schema ?? ""}\u0000${r.table}\u0000${r.column}\u0000${r.matchKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(r);
  }
  return { passed: !any, references, ...(unresolvedScope ? { unresolvedScope } : {}) };
}

export function sensitiveRuleFor(scan: SensitiveScan): SensitiveReferenceRuleCode {
  if (scan.references.some((r) => r.matchKind === "table")) return "SENSITIVE_TABLE_REFERENCED";
  if (scan.references.length > 0) return "SENSITIVE_COLUMN_REFERENCED";
  return "UNRESOLVED_TABLE_SCOPE";
}

export function sensitiveStrictMessage(scan: SensitiveScan): string {
  const parts: string[] = [];
  if (scan.references.length > 0) {
    parts.push(`SQL references sensitive identifiers: ${scan.references.map(formatSensitiveReference).join(", ")}`);
  }
  if (scan.unresolvedScope) parts.push(scan.unresolvedScope.message);
  return `Sensitive-identifier guardrail failed (strict mode): ${parts.join("; ")}`;
}
