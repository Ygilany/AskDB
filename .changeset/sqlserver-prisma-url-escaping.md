---
"@askdb/sqlserver": patch
---

Read Prisma's `{…}` escaping in Prisma-style `sqlserver://` connection URLs where the braces wrap a `;`, and read Prisma's credential aliases.

Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` read the braces as part of the value and split on the `;` inside them, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. A `{` whose span up to the first `}` contains a `;` is now an escape, read verbatim as in Prisma's own parser (`{abc;}}45}` is `abc;}45}`; `{{a;b}}` is `{a;b}`). The old parser could never read such a value correctly, because it cut it at the `;`.

Prisma's credential aliases `username`, `uid` and `pwd` are read when `user` or `password` is absent. Before, they were ignored, so such a string had no credentials. The canonical key still wins when both are set.

Every other string connects with exactly the same values as before. Braces that wrap no `;` are plain characters (`password={abc}` is still `{abc}`, and an unclosed `{` is still part of the value), as are an unbraced `=` in a value (`password=a=b`), non-ASCII, whitespace around keys and values, a lenient port, the last of repeated keys, and an unbraced `;` inside a value. `initial catalog` is still ignored. This differs from Prisma, which reads every `{…}` as an escape: a URL shared with Prisma that braces a value without a `;` (such as `password={Pass:Word}`) still sends that value with its braces.
