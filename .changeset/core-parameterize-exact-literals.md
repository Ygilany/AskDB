---
"@askdb/core": patch
---

Parameterize extras are dropped when a literal differs from `sql` only in case or whitespace (#359). The consistency check compared the two forms lower-cased with whitespace collapsed, so a manifest value of `"colorado"` passed against a bound `'Colorado'`, and `unboundSql` + `params` could run something other than the checked `sql` on a case-sensitive comparison. It now compares tokens under the dialect's lexer: a keyword or unquoted name compares as the engine folds it (ASCII letters only, or as written on SQL Server, whose collation may be case-sensitive), strings, quoted names, numbers, parameters and comments must match exactly, tokens that touch on one side must touch on the other (`2fa_enabled` on MySQL, `U&'1'` on Postgres), and an unterminated token never matches. `sql` itself is unchanged; only the reuse artifacts are dropped.
