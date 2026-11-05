---
"@askdb/core": patch
"@askdb/docs-site": patch
---

- **SQL Server: a second statement written without `;` is rejected** (#327). T-SQL needs no `;` between statements, so `validateSelectSql` used to accept `SELECT 1 SELECT 2`, and `ask({ dialect: "sqlserver" })` could return it as validated SQL. On SQL Server it now throws `SqlValidationError` with rule `SQL_MULTI_STATEMENT` for a second `SELECT` that follows no `UNION`, `EXCEPT` or `INTERSECT` and isn't the main query after a leading `WITH`, for a parenthesized query right after a complete value (`SELECT 1 (SELECT 2)`), and for a `label:`. Subqueries after a keyword, an operator, a comma, a `TOP` count or a function name still pass. Dialect ids that are no built-in engine get the same check, because their SQL must pass every engine's checks.
- **SQL Server denies control-flow verbs.** `SQLSERVER_DIALECT.extraForbiddenKeywords` adds `begin`, `declare`, `if`, `while`, `goto`, `return`, `print`, `raiserror`, `throw`, `save`, `break`, `continue`, `open`, `close`, `deallocate`, `add` and `readtext`, so they're rejected unquoted with `SQL_FORBIDDEN_KEYWORD` and quoted in the NL→SQL prompt when a name uses one.
- A second statement that starts with `FETCH`, or with `END`, `GET` or `MOVE CONVERSATION`, still passes: those words also appear in ordinary queries or as column names. Studio's runtime guard for SQL Server batches is #373.
- Docs: Safety boundaries, Studio and the HTTP API reference describe the SQL Server check and what it still misses.
