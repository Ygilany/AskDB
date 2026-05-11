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
