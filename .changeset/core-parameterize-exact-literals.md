---
"@askdb/core": patch
---

Parameterize extras are dropped when a literal differs from `sql` only in case or whitespace (#359). The consistency check compared the two forms lower-cased with whitespace collapsed, so a manifest value of `"colorado"` passed against a bound `'Colorado'`, and `unboundSql` + `params` could run something other than the checked `sql` on a case-sensitive comparison. It now compares tokens under the dialect's lexer: keywords and unquoted names ignore case, while strings, quoted names, numbers, parameters and comments must match exactly, and an unterminated token never matches. `sql` itself is unchanged; only the reuse artifacts are dropped.
