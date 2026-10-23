---
"@askdb/core": minor
"@askdb/studio": patch
"askdb": patch
"@askdb/docs-site": patch
---

`ask()` keeps a model's single trailing `;` in the SQL it returns instead of removing it, so `sql` is the statement the model wrote. `validateSelectSql` returns the SQL trimmed and otherwise as written, including the `;` and any whitespace before it; `unboundSql`, `preparedQuery.namedSql` and `bindPreparedQuery`'s `sql` and `unboundSql` keep the `;` of the model block they come from. The single-statement check is unchanged: any `;` other than one trailing `;` still throws `SQL_MULTI_STATEMENT`, and a dialect's `extraValidate` still runs on the statement without it.

If you wrap the SQL, remove the `;` first: `SELECT * FROM (${sql}) AS q LIMIT 1000` is a syntax error on every engine when `sql` ends in `;`. The [Row limits](https://askdb.tools/guides/run-safely-in-prod/#row-limits) guide now does this with `sql.replace(/;$/, "").trimEnd()`. Studio's Playground **Execute** removes it before its row cap. `askdb ask` prints the SQL as `ask()` returned it, instead of adding a `;` of its own, which printed `;;` for a reply that ends in one.
