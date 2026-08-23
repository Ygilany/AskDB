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

export type QueryParameterRejectionReason =
  | "INVALID_NAME"
  | "RESERVED_NAME"
  | "INVALID_VALUE"
  | "MISSING_VALUE"
  | "UNRESOLVED_PLACEHOLDER"
  | "INVALID_LIST_CONTEXT"
  | "DIALECT_UNSUPPORTED";

export class QueryParameterError extends AskDbError {
  constructor(
    message: string,
    public readonly reason: QueryParameterRejectionReason,
  ) {
    super(message);
    this.name = "QueryParameterError";
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

/** How a sensitive identifier was matched inside a statement. */
export type SensitiveMatchKind =
  /** `table.column` or `alias.column` where the alias binds to the owning table. */
  | "qualified"
  /** Bare `column`, counted only because the owning table is in the statement's scope. */
  | "unqualified"
  /** The sensitive table itself appears as a `FROM`/`JOIN` target (`column` is `"*"`). */
  | "table";

/** A sensitive table/column the statement was found to reference. */
export type SensitiveReference = {
  /** Table name exactly as spelled in the schema artifact (never schema-qualified). */
  table: string;
  /** Database schema (namespace) the table belongs to, when the artifact records one. */
  schema?: string;
  /** Column name, or `"*"` when `matchKind` is `"table"`. */
  column: string;
  matchKind: SensitiveMatchKind;
};

/** Why the statement's table scope could not be resolved with confidence. */
export type SensitiveScopeIssue =
  /** No `FROM`/`JOIN` target resolved, so unqualified names cannot be bound to a table. */
  | "NO_TABLE_SOURCE"
  /** A `qualifier.column` reference whose qualifier is neither a known table, alias, nor CTE. */
  | "UNKNOWN_QUALIFIER"
  /** A table source that is not a relation name (table function, `VALUES`, …). */
  | "OPAQUE_TABLE_SOURCE";

/** Conservative-failure report attached when scope resolution was incomplete. */
export type SensitiveScopeReport = {
  issues: SensitiveScopeIssue[];
  /**
   * True when at least one unqualified name was matched against *every* sensitive
   * column in the schema rather than only the columns of in-scope tables.
   */
  widened: boolean;
  message: string;
};

/** Machine-readable ids for the sensitive-identifier guardrail (mirrors {@link TenantGuardrailRuleCode}). */
export type SensitiveReferenceRuleCode =
  | "SENSITIVE_TABLE_REFERENCED"
  | "SENSITIVE_COLUMN_REFERENCED"
  | "UNRESOLVED_TABLE_SCOPE";

export class SensitiveReferenceError extends AskDbError {
  constructor(
    message: string,
    public readonly rule: SensitiveReferenceRuleCode,
    public readonly references: SensitiveReference[],
    public readonly unresolvedScope?: SensitiveScopeReport,
  ) {
    super(message);
    this.name = "SensitiveReferenceError";
  }
}
