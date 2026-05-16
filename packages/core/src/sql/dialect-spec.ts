/**
 * `DialectSpec` — a small descriptor each SQL engine supplies so the centralized
 * NL→SQL pipeline (in this package) can generate dialect-correct SELECT queries
 * without each integration package re-implementing the prompt / validator.
 *
 * Authoring guidance:
 *   - Keep `promptBrief` to one short paragraph; surfaced in the model's user prompt.
 *   - `extraForbiddenKeywords` is additive on top of the dialect-agnostic read-only
 *     denylist (`insert`, `update`, `delete`, `drop`, …) baked into `validateSelectSql`.
 *   - `extraValidate` runs *after* the base validator passes; throw a
 *     `SqlValidationError` to reject dialect-specific shapes.
 */

/** Stable identifier for a built-in dialect. Connectors may surface this via `IntrospectionResult.provider`. */
export type DialectId =
  | "postgres"
  | "cockroachdb"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "sqlserver";

export type DialectSpec = {
  id: DialectId;
  displayName: string;
  /** One short paragraph injected into the NL→SQL user prompt. */
  promptBrief: string;
  /** Identifier quoting style — informational; mainly steers `promptBrief`. */
  identifierQuote: '"' | '`';
  /** Extra keywords to forbid on top of the dialect-agnostic base denylist. */
  extraForbiddenKeywords?: readonly string[];
  /** Optional engine-specific post-validator. Receives SQL already passing the base shape checks. */
  extraValidate?: (sql: string) => void;
};

/** PostgreSQL — the original AskDB target. */
export const POSTGRES_DIALECT: DialectSpec = {
  id: "postgres",
  displayName: "PostgreSQL",
  promptBrief:
    "Target PostgreSQL. Use ILIKE for case-insensitive matching. " +
    "Quote identifiers with double quotes when they collide with keywords or contain mixed case. " +
    'Cast with `value::type`. Use NOW(), CURRENT_DATE, date_trunc(). Concatenate with `||`.',
  identifierQuote: '"',
};

/** CockroachDB — PostgreSQL-wire-compatible; reuses the Postgres prompt brief. */
export const COCKROACHDB_DIALECT: DialectSpec = {
  ...POSTGRES_DIALECT,
  id: "cockroachdb",
  displayName: "CockroachDB",
};

/** MySQL — backtick identifiers, CONCAT() for concat, no ILIKE. */
export const MYSQL_DIALECT: DialectSpec = {
  id: "mysql",
  displayName: "MySQL",
  promptBrief:
    "Target MySQL. Use LIKE (case-insensitive by default on common collations); for case-sensitive matching use BINARY or a `_bin` collation. " +
    "Quote identifiers with backticks when they collide with reserved words. " +
    "Cast with `CAST(value AS type)`. Use NOW(), CURDATE(), DATE_FORMAT(), DATE_SUB(), DATE_ADD(). " +
    "Concatenate with `CONCAT(a, b)` — `||` is logical OR in MySQL, not string concat. " +
    "Limit rows with `LIMIT n` (or `LIMIT offset, n`).",
  identifierQuote: "`",
};

/**
 * MariaDB — MySQL-protocol-compatible; the SELECT surface is functionally
 * identical for AskDB's purposes, so we reuse the MySQL prompt brief and
 * keep a distinct id for connectors that report `"mariadb"` explicitly.
 */
export const MARIADB_DIALECT: DialectSpec = {
  ...MYSQL_DIALECT,
  id: "mariadb",
  displayName: "MariaDB",
};

/** SQLite — single-file DBs with dynamic typing and a smaller function set. */
export const SQLITE_DIALECT: DialectSpec = {
  id: "sqlite",
  displayName: "SQLite",
  promptBrief:
    "Target SQLite. Use LIKE (case-insensitive for ASCII by default; for full Unicode case-insensitivity wrap operands in LOWER()). " +
    "Quote identifiers with double quotes when they collide with reserved words. " +
    "Cast with `CAST(value AS type)`. Date/time helpers: date('now'), datetime('now'), strftime('%Y-%m', col). " +
    "Concatenate with `||`. Limit rows with `LIMIT n` (optionally `LIMIT n OFFSET m`). " +
    "SQLite uses dynamic typing — keep CAST conservative and prefer text/integer/real over engine-specific types.",
  identifierQuote: '"',
  // ATTACH/DETACH bring other DBs into scope; PRAGMA is configuration; REINDEX
  // is maintenance. None belong in a generated read-only SELECT. (`vacuum` is
  // already in the dialect-agnostic base denylist.)
  extraForbiddenKeywords: ["attach", "detach", "pragma", "reindex"],
};

/** Microsoft SQL Server (T-SQL). */
export const SQLSERVER_DIALECT: DialectSpec = {
  id: "sqlserver",
  displayName: "Microsoft SQL Server",
  promptBrief:
    "Target Microsoft SQL Server (T-SQL). Use LIKE with LOWER() for case-insensitive matching when the collation is case-sensitive (no ILIKE in T-SQL). " +
    "Quote identifiers with [square brackets] or double quotes. " +
    "Cast with `CAST(value AS type)` or `CONVERT(type, value)`. " +
    "Use GETDATE(), SYSUTCDATETIME(), DATEADD(), DATEDIFF(), FORMAT(). " +
    "Concatenate with `+` (strings only — use ISNULL/COALESCE around nullable operands) or `CONCAT(a, b)`. " +
    "Limit rows with `SELECT TOP (n) …` or `ORDER BY … OFFSET m ROWS FETCH NEXT n ROWS ONLY` — there is no LIMIT keyword.",
  identifierQuote: '"',
  // T-SQL keywords that shouldn't appear in read-only analytics SQL. (`call`
  // is already in the base denylist; T-SQL uses EXEC / EXECUTE for procs.)
  extraForbiddenKeywords: ["exec", "execute", "merge", "openrowset", "openquery"],
};

/**
 * Registry of dialect specs shipped with `@askdb/core`. Connectors that
 * surface `provider` (`@askdb/postgres`, `@askdb/prisma`, …) auto-pick the
 * matching spec; users can override via `askdb.config.dialect`.
 */
export const BUILT_IN_DIALECTS = {
  postgres: POSTGRES_DIALECT,
  cockroachdb: COCKROACHDB_DIALECT,
  mysql: MYSQL_DIALECT,
  mariadb: MARIADB_DIALECT,
  sqlite: SQLITE_DIALECT,
  sqlserver: SQLSERVER_DIALECT,
} as const satisfies Record<DialectId, DialectSpec>;

export type BuiltInDialectId = keyof typeof BUILT_IN_DIALECTS;

export const SUPPORTED_DIALECT_IDS: readonly BuiltInDialectId[] = Object.keys(
  BUILT_IN_DIALECTS,
) as readonly BuiltInDialectId[];

export function isBuiltInDialectId(value: unknown): value is BuiltInDialectId {
  return typeof value === "string" && value in BUILT_IN_DIALECTS;
}

/**
 * Look up a built-in dialect by id. Throws when no spec ships for the id —
 * tell callers (e.g. Prisma auto-detection) to surface a helpful "set
 * `config.dialect` explicitly" message in that case.
 */
export function getDialectSpec(id: BuiltInDialectId): DialectSpec {
  const spec = BUILT_IN_DIALECTS[id];
  if (!spec) {
    throw new Error(
      `No DialectSpec is registered for '${id}'. Supported: ${SUPPORTED_DIALECT_IDS.join(", ")}.`,
    );
  }
  return spec;
}
