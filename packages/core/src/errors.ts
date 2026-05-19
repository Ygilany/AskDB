export class AskDbError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AskDbError";
  }
}

export class SchemaParseError extends AskDbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "SchemaParseError";
  }
}

/** Machine-readable ids for CLI and logs (Phase 2 guardrails). */
export type SqlValidationRuleCode =
  | "SQL_EMPTY"
  | "SQL_MULTI_STATEMENT"
  | "SQL_COMMENT"
  | "SQL_NOT_SELECT_OR_WITH"
  | "SQL_FORBIDDEN_KEYWORD";

export class SqlValidationError extends AskDbError {
  constructor(
    message: string,
    public readonly rule: SqlValidationRuleCode,
    /** Extra human context (why the rule exists, remediation). */
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "SqlValidationError";
  }
}

export class SqlGenerationError extends AskDbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "SqlGenerationError";
  }
}

export type TenantScopeRejectionReason =
  | "MISSING_SCOPE"
  | "UNKNOWN_TENANT_ROOT"
  | "GLOBAL_WITHOUT_REASON"
  | "INVALID_SCOPE_SHAPE";

export class TenantScopeError extends AskDbError {
  constructor(
    message: string,
    public readonly reason: TenantScopeRejectionReason,
  ) {
    super(message);
    this.name = "TenantScopeError";
  }
}

export type TenantGuardrailRuleCode =
  | "MISSING_TENANT_PREDICATE"
  | "MISSING_TYPE_DISCRIMINATOR"
  | "INCOMPATIBLE_JOIN_SCOPES"
  | "UNKNOWN_TABLE_REFERENCED"
  | "CROSS_TENANT_WITHOUT_GLOBAL"
  | "UNPROVABLE_SCOPE";

export type TenantGuardrailWarning = {
  rule: TenantGuardrailRuleCode;
  tableId: string;
  message: string;
};

export class TenantGuardrailError extends AskDbError {
  constructor(
    message: string,
    public readonly warnings: TenantGuardrailWarning[],
  ) {
    super(message);
    this.name = "TenantGuardrailError";
  }
}
