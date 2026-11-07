---
"@askdb/core": minor
---

Under the built-in `sqlserver` dialect, the tenant check refuses code SQL Server may split into tokens differently from the lexer, with `NOT_SELECT_OR_WITH`, the way the read-only check refuses it (#623 review): a character outside plain code (such as a non-breaking space), a bare money sign, a `\`, a number written against a word, or a `?` against a name, outside strings, quoted names and comments. The check's SQL Server reading follows the lexer's model of SQL Server's token ends, which can't be checked against SQL Server's own. Through `ask()` nothing changes, since the read-only check refuses the same text first.

Upgrade notes (breaking): a direct `validateTenantGuardrails()` call under `sqlserver` that passed such SQL now reports `NOT_SELECT_OR_WITH`. Separate keywords, names and numbers with ASCII spaces, and keep other characters inside string literals or `[bracketed]` names.
