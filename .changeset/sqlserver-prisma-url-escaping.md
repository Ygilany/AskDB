---
"@askdb/sqlserver": patch
---

Read Prisma's `{…}` escaping in Prisma-style `sqlserver://` connection URLs.

Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` read the braces as part of the value and split on the `;` inside them, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. A `{` now opens a span read verbatim up to the first `}`, as in Prisma's own parser (`{abc;}}45}` is `abc;}45}`), and Prisma's credential aliases `username`, `uid` and `pwd` are read when `user` or `password` is absent (the canonical key still wins when both are set).

A string without `{` connects with exactly the same values as before: an unbraced `=` in a value (`password=a=b`), non-ASCII, whitespace around keys and values, a lenient port, the last of repeated keys, and an unbraced `;` inside a value all behave as they did, and `initial catalog` is still ignored.

A value that holds a literal `{` is read differently: before, braces were plain characters, so `password={abc}` was `{abc}` and is now `abc`, `a{b}c` is now `abc`, and a `{` that is never closed (`password=ab{cd`) now throws. To keep a literal brace, write it inside a braced run, as in Prisma: `{a{b}}c` is `a{b}c`.
