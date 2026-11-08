---
"@askdb/core": patch
---

The tenant prompt tells the model that in a query with a `LEFT`, `RIGHT`, `FULL` or `OUTER` join, every tenant predicate and every join-path equality goes in `WHERE`, even where an `ON` already has it, since the tenant check counts no `ON` in such a query (#400).
