---
"@askdb/docs-site": patch
---

The beta.55 upgrade note says the tenant prompt now tells the model to put tenant predicates and join-path equalities in `WHERE` in a query with an outer join or `OUTER APPLY`, and to filter a scoped table on an outer join's unmatched side in a derived table or CTE (#400).
