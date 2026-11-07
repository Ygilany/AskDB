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
  /**
   * A call to a function in the dialect's `blockedFunctions` (e.g. `pg_sleep(`, `LOAD_FILE(`), or, on
   * every dialect, `NEXT VALUE FOR`, which advances a sequence on MariaDB and SQL Server.
   */
  | "SQL_FORBIDDEN_FUNCTION"
  /** A string, quoted identifier, dollar-quoted string, or block comment never closes. */
  | "SQL_UNTERMINATED"
  /**
   * Postgres family: an `E'…'` string continued on a later line (`E'a'`, a newline, `'b'`).
   * Postgres reads the continuation with backslash escapes and the checks don't, so they could
   * read code as a string; refused at the boundary (#703).
   */
  | "SQL_STRING_CONTINUATION"
  /**
   * Postgres family: a `b'…'` byte string (lower-case `b`) that holds a backslash or is continued
   * on a later line. CockroachDB reads it with backslash escapes and the checks don't, so they
   * could read code as a string; refused at the boundary (#730).
   */
  | "SQL_ESCAPED_BYTE_STRING"
  /**
   * Postgres family: a Unicode-escaped identifier (`U&"set\005fconfig"`). Its escapes can spell
   * a name the other checks look for, such as a denylisted function, so it is refused (#692).
   */
  | "SQL_UNICODE_ESCAPED_IDENTIFIER"
  /**
   * A locking read: `FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`, or a T-SQL lock hint such as
   * `UPDLOCK`; on SQL Server, also a name that isn't printable ASCII, unquoted or quoted alone in
   * parentheses after a name, which SQL Server may read as a hint.
   */
  | "SQL_LOCKING_READ";

export class SqlValidationError extends AskDbError {
  /**
   * Every guardrail finding for the statement, when the error comes from an enforcement
   * point (`ask()`, `generateSelectSql()`, `bindPreparedQuery()`). Absent when thrown by a
   * direct `validateSelectSql()` call.
   */
  verdict?: GuardrailVerdict;

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

/**
 * A `dialect` passed to `ask()` that isn't a built-in dialect id: a string, or a `DialectSpec`
 * whose `id` isn't one (#717). `dialectId` is the id it got.
 */
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
  /** A `global` scope whose `reason` is missing, not a string, or blank: global access must say why. */
  | "GLOBAL_WITHOUT_REASON"
  | "INVALID_SCOPE_SHAPE"
  /**
   * A `subtree` scope could not be expanded: no `resolveTenantDescendants`, or it
   * returned something other than IDs per tenant root (a flat array, a key that
   * isn't a root in the subtree, a value that isn't an array of non-empty strings,
   * or no IDs at all). Also thrown when an unexpanded `subtree` reaches
   * `resolveTenantSql()` or `buildTenantPromptBlock()` directly.
   */
  | "SUBTREE_NOT_RESOLVABLE"
  /** Generated SQL references a `:tenant_*` placeholder the scope has no IDs for. */
  | "UNRESOLVED_TENANT_PLACEHOLDER"
  /** A multi-ID scope met a tenant predicate with no list form (e.g. `<=`). */
  | "UNSUPPORTED_TENANT_PREDICATE"
  /**
   * A tenant ID that isn't printable ASCII (U+0020 to U+007E), or that contains a
   * backslash, would be inlined as a literal: by `ask()`, `resolveTenantSql()` or
   * `bindPreparedQuery()` in `sql-only` mode. It's refused on
   * every dialect, because a server whose string settings or connection charset differ
   * from the dialect's can read part of it as the end of the literal (a backslash, or a
   * `¥` sent as byte 0x5C under `sjis`). Use `tenantSqlMode: "sql-params"` (the default)
   * to pass such IDs as driver parameters.
   */
  | "UNESCAPABLE_TENANT_ID"
  /**
   * `ask()` got a tenant scope, no `tenantSqlMode`, and a custom `AskDialect`. AskDB can't
   * know which driver markers such a dialect takes, and its `$N` default is a money
   * constant on SQL Server, so the host must choose `"sql-params"` or `"sql-only"`.
   * Also thrown, on every dialect, when `ask()` (with a tenant scope) or
   * `resolveTenantSql()` gets a `tenantSqlMode` that is neither of the two.
   */
  | "TENANT_SQL_MODE_REQUIRED";

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
  | "INVALID_VALUE"
  | "MISSING_VALUE"
  | "UNRESOLVED_PLACEHOLDER"
  | "INVALID_LIST_CONTEXT"
  | "DIALECT_UNSUPPORTED"
  /** `bindPreparedQuery()` was called without its third argument (`BindGuardrails`), or without `schema` in it. */
  | "MISSING_GUARDRAIL_CONTEXT"
  /** `values` has a `:tenant_*` key. Tenant IDs come from `tenantScope` only. */
  | "TENANT_VALUE_SUPPLIED"
  /** The tenant markers in `unboundSql` can't be lined up with the business parameters. */
  | "TENANT_PARAM_ALIGNMENT"
  /**
   * `bindPreparedQuery()` needs `guardrails.dialect`: the template was made under a host's
   * `DialectSpec` (`dialectRules: "host"`), or stored without `dialectRules`.
   */
  | "DIALECT_SPEC_REQUIRED"
  /**
   * A parameter in the stored template declares a `type` or `cardinality` AskDB doesn't support.
   * The template is broken: regenerate it rather than passing another value.
   */
  | "INVALID_DECLARATION";

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
  | "UNKNOWN_TABLE_REFERENCED"
  | "UNPROVABLE_SCOPE"
  /**
   * A statement doesn't start with `SELECT` or `WITH` (a `DO` block, `CALL`, `EXPLAIN`,
   * `SHOW`, …), so the tenant check can't read what it touches. A statement ends at each
   * `;`, and on SQL Server also at a statement verb such as `EXEC` with no `;` before it.
   * Reported for the whole SQL, with `tableId: ""`, under every dialect, a custom
   * `AskDialect` included; not under a `global` scope, where the tenant check doesn't run
   * (#698).
   */
  | "NOT_SELECT_OR_WITH"
  /**
   * The SQL names a function whose reads the tenant check can't see, in any code position (a
   * column, alias or placeholder named like one counts too): one that runs a query
   * passed as a string (`query_to_xml`, `crosstab`), reads a table named in a string
   * (`table_to_xml`), runs SQL over another connection (`dblink`, `OPENQUERY`), or sets a
   * value row-level security may read (`set_config`). Reported for the whole SQL, with
   * `tableId: ""`, under every dialect, a custom `AskDialect` included; not under a `global`
   * scope (#702).
   */
  | "UNCHECKABLE_FUNCTION"
  /**
   * A Postgres Unicode-escaped name (`U&"\006Frders"`) in any position: a table, a column or a
   * function. Postgres decodes it, and the tenant check matches names as written, so it can't
   * tell what the name reads. Reported for the whole SQL, with `tableId: ""`, whenever the SQL
   * is read as Postgres: postgres, cockroachdb, a custom `AskDialect`, or no dialect; not under
   * a `global` scope (#704, #692).
   */
  | "UNICODE_ESCAPED_IDENTIFIER"
  /**
   * An `E'…'` string continued on a later line, which Postgres reads with backslash escapes and
   * the tenant check doesn't, so a table or call after it could be hidden. Reported for the
   * whole SQL, with `tableId: ""`, whenever the SQL may be read as Postgres: postgres,
   * cockroachdb, a custom `AskDialect`, or no dialect; not under a `global` scope (#703).
   */
  | "STRING_CONTINUATION"
  /**
   * A `b'…'` byte string (lower-case `b`) that holds a backslash or is continued on a later line,
   * which CockroachDB reads with backslash escapes and the tenant check doesn't, so a table or
   * call after it could be hidden. Reported for the whole SQL, with `tableId: ""`, whenever the
   * SQL may be read as Postgres: postgres, cockroachdb, a custom `AskDialect`, or no dialect; not
   * under a `global` scope (#730).
   */
  | "ESCAPED_BYTE_STRING";

export type TenantGuardrailWarning = {
  rule: TenantGuardrailRuleCode;
  tableId: string;
  message: string;
};

export class TenantGuardrailError extends AskDbError {
  /** Every guardrail finding for the statement, when thrown by an enforcement point. */
  verdict?: GuardrailVerdict;

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
  | "UNTERMINATED_TOKEN"
  /**
   * A Postgres Unicode-escaped name (`U&"p\0061ssword"`), which Postgres decodes and the check
   * matches as written, so it can't tell which column it names. Raised whenever the SQL may be
   * read as Postgres: postgres, cockroachdb, a custom `AskDialect`, or no dialect (#707, #692).
   */
  | "UNICODE_ESCAPED_IDENTIFIER"
  /**
   * An `E'…'` string continued on a later line, which Postgres reads with backslash escapes and
   * the check doesn't, so a column after it could be hidden. Raised whenever the SQL may be read
   * as Postgres (#707, #703).
   */
  | "STRING_CONTINUATION"
  /**
   * A `b'…'` byte string (lower-case `b`) that holds a backslash or is continued on a later line,
   * which CockroachDB reads with backslash escapes and the check doesn't, so a column after it
   * could be hidden. Raised whenever the SQL may be read as Postgres (#730).
   */
  | "ESCAPED_BYTE_STRING";

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
  /** Every guardrail finding for the statement, when thrown by an enforcement point. */
  verdict?: GuardrailVerdict;

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

/**
 * An enrichment suggestion was asked for a sensitive column while
 * `omitSensitiveIdentifiersFromPrompt` is on: the prompt can't name the column, so no model is
 * called (ADR 0026). The message names no identifier.
 */
export class SensitiveEnrichmentTargetError extends AskDbError {
  constructor() {
    super(
      "The suggestion is for a sensitive column, and omitSensitiveIdentifiersFromPrompt keeps sensitive columns out of the prompt.",
    );
    this.name = "SensitiveEnrichmentTargetError";
  }
}

// ---------------------------------------------------------------------------
// Guardrail verdicts (ADR 0010)
// ---------------------------------------------------------------------------

/** The SQL checks AskDB runs on model-generated SQL. */
export type GuardrailCheckId = "read-only" | "tenant" | "sensitive";

/**
 * Which form of the statement a finding is about, before AskDB renders it: `sql` is the
 * model's bound SQL, `template` is its `sql-unbound` block (`preparedQuery.namedSql`),
 * both with their `:tenant_<root>_ids` placeholders in place.
 */
export type GuardrailForm = "sql" | "template";

/** `allow`: no findings. `warn`: returned (or bound) and reported. `deny`: refused with a typed error. */
export type GuardrailOutcome = "allow" | "warn" | "deny";

/** One problem a check found. The `check` field says which check, and which detail fields are set. */
export type GuardrailFinding =
  | {
      check: "read-only";
      form: GuardrailForm;
      rule: SqlValidationRuleCode;
      message: string;
      hint?: string;
    }
  | {
      check: "tenant";
      /** `"generator"`: reported by a custom `AskDialect`'s `tenantGuardrail`. */
      form: GuardrailForm | "generator";
      rule: TenantGuardrailRuleCode;
      message: string;
      /** The table the finding is about; empty for a custom generator's failure with no details. */
      tableId: string;
    }
  | {
      check: "sensitive";
      form: GuardrailForm;
      rule: SensitiveReferenceRuleCode;
      message: string;
      /** The sensitive table or column referenced (`SENSITIVE_TABLE_REFERENCED` / `SENSITIVE_COLUMN_REFERENCED`). */
      reference?: SensitiveReference;
      /** Why the table scope couldn't be resolved (`UNRESOLVED_TABLE_SCOPE`). */
      unresolvedScope?: SensitiveScopeReport;
    };

/**
 * The decision for one statement: the most severe outcome across its findings, and every
 * finding. In-memory only: AskDB doesn't persist it, so it carries no format version.
 */
export type GuardrailVerdict = {
  outcome: GuardrailOutcome;
  findings: GuardrailFinding[];
};
