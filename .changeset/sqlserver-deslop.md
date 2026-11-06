---
"@askdb/sqlserver": patch
---

`@askdb/sqlserver` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: every connection-string form connects with the same values, connection labels are the same, and the `mssql` driver loading works as before.
