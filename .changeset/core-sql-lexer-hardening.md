---
"@askdb/core": minor
---

**@askdb/core**: SQL validation now lexes SQL the way each database does, closing several read-only and sensitive-column bypasses. These checks are defense in depth, not a security boundary — run generated SQL under a read-only database role.

A new internal dialect-aware lexer is shared by `validateSelectSql`, `validateSensitiveReferences`, and the placeholder scanner. It knows Postgres `E'…'` strings and exact-tag `$tag$…$tag$` quoting, that Postgres `"…"` has no backslash escape and `[` is an array subscript, MySQL backslash escapes (per `DialectSpec.backslashEscapes`) and `#` / `/*! … */` comments, SQL Server `[…]` with `]]`, and SQLite's quoting forms.

`validateSelectSql` now rejects SQL it previously accepted:

- Multi-statement and data-modifying-CTE payloads hidden behind engine-specific quoting (`E'\''`, `"x\"`, `$$ $ $$`, `ARRAY['a]']`, MySQL `'\''`, MySQL `#` comments).
- `SELECT … INTO` on every dialect, including MySQL `INTO OUTFILE` / `INTO DUMPFILE` (`into` and `merge` join the shared keyword denylist).
- SQL Server statement verbs that run without a semicolon (`SHUTDOWN`, `WAITFOR`, `KILL`, `BACKUP`, `RESTORE`, `DBCC`, `RECONFIGURE`, `DENY`, `BULK`, `USE`, `SET`, `OPENDATASOURCE`, …).
- Calls to side-effecting functions listed in the new `DialectSpec.blockedFunctions` (new rule `SQL_FORBIDDEN_FUNCTION`): e.g. Postgres `pg_sleep`, `set_config`, `pg_read_file`, `lo_import`/`lo_export`, `dblink_exec`, `pg_terminate_backend`, `nextval`; MySQL `SLEEP`, `BENCHMARK`, `LOAD_FILE`; SQLite `load_extension`.
- Unterminated strings, quoted identifiers, dollar-quotes, and block comments (new rule `SQL_UNTERMINATED`) — previously accepted silently.
- More than one trailing semicolon (`SELECT 1;;`), a quoted `"select"` as the first token, and `--` / `/*` sequences that MySQL lexes as operators.

Keywords are matched on whole unquoted tokens, so `created_into`, `copy_count`, `"delete"`, and `'delete me'` still pass. A `DialectSpec` whose `id` is not a built-in family must pass under every built-in lexer and denylist.

`validateSensitiveReferences` gains an optional `dialect` option and now reports `SELECT *`, `alias.*`, and whole-row references (`row_to_json(u)`, `to_jsonb(u)`, `json_agg(u)`) as referencing the table's sensitive columns. Without `dialect`, references are unioned across every built-in engine's reading. An unterminated token is reported as the new `UNTERMINATED_TOKEN` scope issue.

Also: `SqlValidationRuleCode` adds `SQL_FORBIDDEN_FUNCTION` and `SQL_UNTERMINATED`; `SensitiveScopeIssue` adds `UNTERMINATED_TOKEN`. Placeholder scanning no longer reads the type in a `value::type` cast, or text inside a comment, as a `:name` placeholder.
