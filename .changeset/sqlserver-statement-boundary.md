---
"@askdb/core": minor
"@askdb/docs-site": patch
---

- **SQL Server: a second statement written without `;` is rejected** (#327). T-SQL needs no `;` between statements, so `validateSelectSql` used to accept `SELECT 1 SELECT 2`, and `ask({ dialect: "sqlserver" })` could return it as checked SQL. On SQL Server it now throws `SqlValidationError` with rule `SQL_MULTI_STATEMENT` for a second `SELECT` that follows no `UNION`, `EXCEPT` or `INTERSECT` and isn't the main query after a leading `WITH`, for a parenthesized query right after a complete value (`SELECT 1 (SELECT 2)`), and for a `label:`. A subquery after a keyword, an operator, a comma, a `TOP` count or a function name still passes. Dialect ids that are no built-in engine get the same check, because their SQL must pass every engine's checks.
- **SQL Server denies control-flow verbs.** `SQLSERVER_DIALECT.extraForbiddenKeywords` adds `begin`, `declare`, `if`, `while`, `goto`, `return`, `print`, `raiserror`, `throw`, `save`, `break`, `continue`, `open`, `close`, `deallocate`, `add` and `readtext`. They're rejected unquoted with `SQL_FORBIDDEN_KEYWORD`, and the NL→SQL prompt quotes a name that uses one.
- **The SQL Server lexer ends literals where SQL Server does.** `0x` with no hex digits, an exponent with no digits (`1E`), and money literals that start with a currency symbol (`$`, `$1`, `€`) end before a following keyword, and U+200B and U+0085 count as whitespace.
- **Upgrade notes (breaking):** SQL that passed before and now throws:
  - on SQL Server, an unquoted name that is one of the new denylist words; all but `throw` are T-SQL reserved words already, so SQL Server itself needed them quoted;
  - on SQL Server, a parenthesized subquery after a token the check doesn't list as starting an expression, such as an ODBC escape `{fn …}`;
  - on a dialect id that is no built-in engine: those names and shapes, plus MySQL `IF(…)`, Postgres `LATERAL (SELECT …)` and `ARRAY(SELECT …)`, and unquoted names such as `open` or `close`.
- A second statement that starts with `FETCH`, or with `END`, `GET` or `MOVE CONVERSATION`, still passes, because those words also appear in ordinary queries or as column names. Studio's runtime guard for SQL Server batches is #373.
- Docs: Safety boundaries, Studio, Troubleshooting and the HTTP API reference describe the SQL Server check and what it still misses.
