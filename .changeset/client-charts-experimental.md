---
"@askdb/client": minor
"@askdb/core": patch
"@askdb/docs-site": patch
---

`@askdb/client` gains an experimental entry point, `@askdb/client/charts`, that plans a chart for a query result without sending a row to the model (#906, ADR 0044). `classifyResult()` classifies the result's columns in your process: identifier, year, date, currency, percent, category or measure. `planChart()` sends the model the question, the SQL with every literal replaced by `?`, and the columns' names and kinds, the row count and the truncated flag. It returns a declarative chart spec (metric, line, area, bar, horizontal bar or pie) that `validateChartSpec()` checks against the result, with a part-to-whole policy for pies. A result column name that holds a literal is shown under a neutral label. With `omitSensitiveIdentifiers` and the schema artifact, it follows prompt omission like every other model call. On a timeout, an abort, a model error or an invalid spec it returns a deterministic fallback and says so, and it never rejects because of the model. The entry point is outside the stability promise: a minor release may change it (ADR 0030, ADR 0031). The root `@askdb/client` export doesn't include it, and it adds no dependency.

`@askdb/core` adds `maskSqlLiterals(sql, dialect?)`, an internal export for `@askdb/client/charts` with no stability promise. It replaces a statement's literals with `?` and drops its comments, under the readings the tenant check uses, and returns `undefined` when the statement can't be read safely.

The docs site adds the guide "Plan a chart for a query result" and the `@askdb/client/charts` API reference, both marked experimental, lists `maskSqlLiterals` among core's internal exports, and adds the planner to the privacy model and the sensitive-columns guide.
