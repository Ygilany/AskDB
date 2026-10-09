---
"@askdb/sqlserver": patch
---

Read Prisma's `{…}` escaping in Prisma-style `sqlserver://` connection URLs for a value that holds a `;`, and read Prisma's credential aliases.

Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` read the braces as part of the value and split on the `;` inside them, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. A value that starts with `{`, ends with `}` and holds a `;` in between is now an escape: everything between the braces is the value, read verbatim (`{{a;b}}` is `{a;b}`). The old parser cut such a value at the `;`, so it never connected with the value the user wrote.

Prisma's credential aliases `username`, `uid` and `pwd` are read when `user` or `password` is absent (`username` before `uid`). Before, they were ignored, so such a string had no credentials. The canonical key still wins when both are set.

Every other string connects with exactly the same values as before. Braces anywhere else are plain characters (`password={abc}` is still `{abc}`, an unclosed `{` is still part of the value, and a value whose braces close before any `;`, such as `password={ab}cd`, never reaches into a later value's `}`), as are an unbraced `=` in a value (`password=a=b`), non-ASCII, whitespace around keys and values, a lenient port, the last of repeated keys, and an unbraced `;` inside a value. `initial catalog` is still ignored. This differs from Prisma, which reads every `{…}` as an escape: a URL shared with Prisma that braces a value without a `;` (such as `password={Pass:Word}`) still sends that value with its braces.
