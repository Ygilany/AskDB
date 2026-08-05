---
"@askdb/core": minor
---

**@askdb/core**: `ask()` now returns optional `unboundSql`, `params`, `parameters`, and `preparedQuery` alongside the existing bound `sql` when the model emits a consistent unbound block and parameter manifest (`parameterize` defaults to `true`; set `false` to opt out of the extra output tokens). New exported `bindPreparedQuery()` rebinds a `PreparedQuery` locally with no model call. `DialectSpec` gains `listBinding` and `backslashEscapes`; MySQL/MariaDB literal escaping now doubles backslashes so a value ending in `\` cannot break out of its string. If the model's extras are missing or inconsistent, they are dropped and `result.sql` is unaffected — callers who never read the new fields see today's behavior.
