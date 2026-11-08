---
"@askdb/core": patch
---

The tenant check ends a name or number where SQL Server does (#623): after `0x` or `1E`, and at U+00A0, U+200B and U+0085, which SQL Server reads as whitespace. It reads them that way under `sqlserver`, and under a dialect id that is no built-in engine or no dialect, which may be SQL Server. A keyword written right after one of these is a keyword, so an `OR` written that way is required to keep the tenant predicate ANDed in, as one after a space always was.
