---
"@askdb/studio": patch
---

The Playground runs `sql-params` output correctly, now that it starts in that mode. Replaying a `sql-params` history entry restores the tenant params it was saved with, so Execute no longer sends marker SQL without them. SQL Server Execute binds SQL that already uses `@pN` markers as written: before, it rewrote a `?` or `$…` inside a string literal, or a money literal such as `$1000`, into a marker.
