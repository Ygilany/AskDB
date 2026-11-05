---
"@askdb/core": minor
"@askdb/docs-site": patch
---

- **SQL Server: a second statement written without `;` is rejected** (#327). T-SQL needs no `;` between statements, so `validateSelectSql` used to accept `SELECT 1 SELECT 2`, and `ask({ dialect: "sqlserver" })` could return it as checked SQL. On SQL Server it now throws `SqlValidationError` with rule `SQL_MULTI_STATEMENT` for a second `SELECT` that follows no `UNION`, `EXCEPT` or `INTERSECT` and isn't the main query after a leading `WITH`, for a parenthesized query right after a complete value (`SELECT 1 (SELECT 2)`), and for a `label:`. A subquery after a keyword, an operator, a comma, a `TOP` count or a function name still passes. Dialect ids that are no built-in engine get the same check, because their SQL must pass every engine's checks.
- **SQL Server denies control-flow verbs.** `SQLSERVER_DIALECT.extraForbiddenKeywords` adds `begin`, `declare`, `if`, `while`, `goto`, `return`, `print`, `raiserror`, `throw`, `save`, `break`, `continue`, `open`, `close`, `deallocate`, `add` and `readtext`. They're rejected unquoted with `SQL_FORBIDDEN_KEYWORD`, and the NL→SQL prompt quotes a name that uses one.
- **SQL Server code must be plain.** Outside strings and quoted names, a character other than printable ASCII (`\` excepted) or a Unicode letter, mark or digit (for example U+00A0, U+200B or U+FEFF), a bare money sign, a number written against a word (`1ESELECT`, `0xSELECT`), or a `?` written against a name or number throws `SQL_MULTI_STATEMENT`, because SQL Server may split tokens there differently from AskDB's lexer.
- **The SQL Server lexer ends literals and names where SQL Server does.** `0x` with no hex digits, an exponent with no digits (`1E`), and money literals that start with a currency symbol (`$`, `$1`, `€`) are complete literals, and a name or variable continues through `@` (`a@b` is one name, so `a@b:` is a label) and ends at any character SQL Server reads as whitespace (U+00A0, U+200B, U+0085, but not U+FEFF).
- **Upgrade notes (breaking):** SQL that passed before and now throws:
  - on SQL Server, an unquoted name that is one of the new denylist words; all but `throw` are T-SQL reserved words already, so SQL Server itself needed them quoted;
  - on SQL Server, a parenthesized subquery after a token the check doesn't list as starting an expression, such as an ODBC escape `{fn …}`;
  - on SQL Server, code outside strings and quoted names that isn't plain, as above, such as a bare `$` or a money sign other than `$`;
  - on SQL Server, a `:` written directly against anything but `(`, a comma or an operator (a name, a number, a string, a quoted name, a `)` or a symbol such as `#@`), which now counts as a label; AskDB's `:name` placeholders after `=`, `(` or `,` still pass;
  - on a dialect id that is no built-in engine: those names and shapes, plus MySQL `IF(…)`, Postgres `LATERAL (SELECT …)` and `ARRAY(SELECT …)`, and unquoted names such as `open` or `close`.
- **Now passes on SQL Server:** a denylist word joined to a name through `@` (`a@delete`), because SQL Server reads the whole thing as one name.
- A second statement that starts with `FETCH`, or with `END`, `GET` or `MOVE CONVERSATION`, still passes, because those words also appear in ordinary queries or as column names. Studio's runtime guard for SQL Server batches is #373.
- Docs: Safety boundaries, Studio, Troubleshooting and the HTTP API reference describe the SQL Server check and what it still misses.
