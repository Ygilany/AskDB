/**
 * `DialectSpec` — a small descriptor each SQL engine supplies so the centralized
 * NL→SQL pipeline (in this package) can generate dialect-correct SELECT queries
 * without each integration package re-implementing the prompt / validator.
 *
 * Authoring guidance:
 *   - Keep `promptBrief` to one short paragraph; surfaced in the model's user prompt.
 *   - `extraForbiddenKeywords` is additive on top of the dialect-agnostic read-only
 *     denylist (`insert`, `update`, `delete`, `drop`, `into`, …) baked into
 *     `validateSelectSql`. Matched against unquoted keyword tokens only.
 *   - `blockedFunctions` lists functions with side effects (writes, file/network access,
 *     sleeping, session changes) that `validateSelectSql` rejects when called.
 *   - `extraValidate` runs *after* the base validator passes; throw a
 *     `SqlValidationError` to reject dialect-specific shapes.
 *   - `id` also selects how SQL is lexed (string escapes, quoting, comment syntax) — see
 *     `lexer.ts`. Specs that spread a built-in (`{ ...POSTGRES_DIALECT, … }`) inherit its
 *     denylists; a spec that overrides `extraForbiddenKeywords` / `blockedFunctions`
 *     replaces them.
 *
 * These lists are defense in depth for model-generated SQL, not a security boundary:
 * execute generated SQL under a read-only database role.
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
  /**
   * Function names `validateSelectSql` rejects when called (`name(`, including
   * schema-qualified and quoted spellings). Case-insensitive.
   */
  blockedFunctions?: readonly string[];
  /** Optional engine-specific post-validator. Receives SQL already passing the base shape checks. */
  extraValidate?: (sql: string) => void;
  /** How list-valued placeholders bind in `unboundSql`. Default "expand" when absent. */
  listBinding?: "array" | "expand";
  /**
   * Whether backslash is an escape character inside string literals. Default false for
   * escaping bound values; the validator's lexer treats an unset value on a MySQL-family
   * spec as the server default (escapes on).
   */
  backslashEscapes?: boolean;
};

/**
 * Postgres functions with side effects or host/file/network access. Superuser-only
 * functions are listed too: the validator does not know the executing role.
 */
const POSTGRES_BLOCKED_FUNCTIONS: readonly string[] = [
  // session / server configuration and process control
  "set_config", "pg_reload_conf", "pg_rotate_logfile", "pg_terminate_backend",
  "pg_cancel_backend", "pg_log_backend_memory_contexts", "pg_promote",
  "pg_switch_wal", "pg_create_restore_point", "pg_start_backup", "pg_stop_backup",
  "pg_backup_start", "pg_backup_stop", "pg_import_system_collations",
  // sleeping
  "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  // server file system
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "pg_ls_logdir",
  "pg_ls_waldir", "pg_ls_tmpdir", "pg_ls_archive_statusdir", "pg_ls_logicalsnapdir",
  "pg_ls_logicalmapdir", "pg_ls_replslotdir", "pg_file_write", "pg_file_rename",
  "pg_file_unlink", "pg_file_sync",
  // large objects (lo_import / lo_export touch the server file system)
  "lo_import", "lo_export", "lo_unlink", "lo_create", "lo_creat", "lo_from_bytea",
  "lo_put", "lo_open", "lo_write", "lowrite", "lo_truncate", "lo_truncate64",
  // dblink runs SQL on another (or the same) server
  "dblink", "dblink_exec", "dblink_connect", "dblink_connect_u", "dblink_open",
  "dblink_send_query", "dblink_fetch", "dblink_get_result",
  // replication slots, messages, notifications
  "pg_create_physical_replication_slot", "pg_create_logical_replication_slot",
  "pg_drop_replication_slot", "pg_copy_physical_replication_slot",
  "pg_copy_logical_replication_slot", "pg_replication_slot_advance",
  "pg_logical_emit_message", "pg_notify",
  // advisory locks
  "pg_advisory_lock", "pg_advisory_lock_shared", "pg_advisory_xact_lock",
  "pg_advisory_xact_lock_shared", "pg_try_advisory_lock", "pg_try_advisory_lock_shared",
  "pg_try_advisory_xact_lock", "pg_try_advisory_xact_lock_shared", "pg_advisory_unlock",
  "pg_advisory_unlock_shared", "pg_advisory_unlock_all",
  // statistics resets
  "pg_stat_reset", "pg_stat_reset_shared", "pg_stat_reset_single_table_counters",
  "pg_stat_reset_single_function_counters", "pg_stat_reset_slru",
  "pg_stat_reset_replication_slot",
  // sequences
  "nextval", "setval",
  // functions that execute a query passed as a string
  "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml",
  "ts_stat",
];

/** PostgreSQL — the original AskDB target. */
export const POSTGRES_DIALECT: DialectSpec = {
  id: "postgres",
  displayName: "PostgreSQL",
  promptBrief:
    "Target PostgreSQL. Use ILIKE for case-insensitive matching. " +
    "Quote identifiers with double quotes when they collide with keywords or contain mixed case. " +
    'Cast with `value::type`. Use NOW(), CURRENT_DATE, date_trunc(). Concatenate with `||`.',
  identifierQuote: '"',
  blockedFunctions: POSTGRES_BLOCKED_FUNCTIONS,
  listBinding: "array",
  backslashEscapes: false,
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
  // INTO OUTFILE / DUMPFILE are also covered by the base `into` keyword.
  extraForbiddenKeywords: ["outfile", "dumpfile"],
  blockedFunctions: [
    "load_file", "sleep", "benchmark", "get_lock", "release_lock", "release_all_locks",
    "master_pos_wait", "source_pos_wait", "wait_for_executed_gtid_set",
    "wait_until_sql_thread_after_gtids", "sys_exec", "sys_eval",
  ],
  listBinding: "expand",
  backslashEscapes: true,
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
  // load_extension loads native code; readfile/writefile/edit are CLI-shell extensions.
  blockedFunctions: ["load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"],
  listBinding: "expand",
  backslashEscapes: false,
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
  // is already in the base denylist; T-SQL uses EXEC / EXECUTE for procs, which also
  // covers `EXEC sp_…` / `EXEC xp_…`.) T-SQL runs a batch without semicolons —
  // `SELECT 1 SHUTDOWN` is two statements — so statement-level verbs are listed here
  // even though they cannot appear inside a SELECT.
  extraForbiddenKeywords: [
    "exec", "execute", "merge", "openrowset", "openquery", "opendatasource",
    "shutdown", "kill", "backup", "restore", "dbcc", "reconfigure", "deny", "waitfor",
    "bulk", "use", "set", "revert", "setuser", "checkpoint", "commit", "rollback",
    "writetext", "updatetext", "disable", "enable", "receive", "send", "xp_cmdshell",
  ],
  listBinding: "expand",
  backslashEscapes: false,
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
