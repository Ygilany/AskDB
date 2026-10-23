---
"@askdb/sqlserver": patch
---

Exclude objects shipped by SQL Server itself (`is_ms_shipped = 1`, e.g. replication `MS*` tables that live in `dbo`) from the table, view, and column catalog queries. The system-schema list alone did not catch them because they are not in a system schema.
