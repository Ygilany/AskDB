---
"@askdb/sqlserver": patch
---

Read Prisma's `{…}` escaping in Prisma-style `sqlserver://` connection URLs. A string that worked before connects with exactly the same values.

Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` read the braces as part of the value and split on the `;` inside them, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. A `{` now opens a span read verbatim up to the first `}`, as in Prisma's own parser (`{abc;}}45}` is `abc;}45}`), and Prisma's credential aliases `username`, `uid` and `pwd` are read. Strings without braces or those aliases are read exactly as before: unbraced `=` in a value (`password=a=b`), non-ASCII, whitespace around keys and values, a lenient port, the last of repeated keys, and an unbraced `;` inside a value all behave as they did. `initial catalog` is still ignored.

Only two cases now throw, both strings whose meaning can't be settled: a `{` that is never closed, and two aliases of one setting with different values (`password=a;pwd=b`).
