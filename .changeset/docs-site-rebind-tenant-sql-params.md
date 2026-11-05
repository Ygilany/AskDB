---
"@askdb/docs-site": patch
---

The core and client API references describe the rebind's `tenantSqlMode` and `tenantParams`, and every rebind example runs `sql` with `tenantParams`. The beta.46 upgrade notes group the three rebind changes (#643's tenant-ID rule, #660's `dialect` and #664's default) under one heading with one before/after snippet. Safety boundaries and troubleshooting say a rebind binds tenant IDs as driver parameters by default (#664).
