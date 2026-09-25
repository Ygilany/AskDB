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
  | "SQL_FORBIDDEN_KEYWORD"
  /** A call to a function in the dialect's `blockedFunctions` (e.g. `pg_sleep(`, `LOAD_FILE(`). */
  | "SQL_FORBIDDEN_FUNCTION"
  /** A string, quoted identifier, dollar-quoted string, or block comment never closes. */
  | "SQL_UNTERMINATED";

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

/** A string `dialect` passed to `ask()` that is not a built-in dialect id. */
export class UnknownDialectError extends AskDbError {
  constructor(
    message: string,
    public readonly dialectId: string,
  ) {
    super(message);
    this.name = "UnknownDialectError";
  }
}

export type TenantScopeRejectionReason =
  | "MISSING_SCOPE"
  | "UNKNOWN_TENANT_ROOT"
  | "GLOBAL_WITHOUT_REASON"
  | "INVALID_SCOPE_SHAPE"
  /** `access.kind` is declared but not implemented (currently `"subtree"`). */
  | "UNSUPPORTED_ACCESS_KIND"
  /** Generated SQL references a `:tenant_*` placeholder the scope has no IDs for. */
  | "UNRESOLVED_TENANT_PLACEHOLDER"
  /** A multi-ID scope met a tenant predicate with no list form (e.g. `<=`). */
  | "UNSUPPORTED_TENANT_PREDICATE";

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
  /**
   * `table.column` or `alias.column` where the alias binds to the owning table. Also
   * `alias.*` and whole-row references such as `row_to_json(alias)`, which reach every
   * sensitive column of the table.
   */
  | "qualified"
  /**
   * Bare `column`, counted only because the owning table is in the statement's scope.
   * Also a bare `SELECT *`, which reaches every sensitive column of the in-scope tables.
   */
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
  | "OPAQUE_TABLE_SOURCE"
  /** A string, quoted identifier, or comment never closes, so the rest of the statement could not be scanned. */
  | "UNTERMINATED_TOKEN";

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
