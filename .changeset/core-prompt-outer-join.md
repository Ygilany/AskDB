---
"@askdb/core": patch
---

The tenant prompt tells the model that in a query with a `LEFT`, `RIGHT`, `FULL` or `OUTER` join, or `OUTER APPLY`, every tenant predicate and every join-path equality goes in `WHERE`, even where an `ON` already has it, since the tenant check counts no `ON` in such a query (#400). A scoped or polymorphic table on the side an outer join may leave unmatched is filtered in a derived table or CTE with its own `WHERE` instead, since a condition on it in the outer `WHERE` would drop the unmatched rows, unless the other side reaches its tenant root through it, where the join is a plain `JOIN`.
