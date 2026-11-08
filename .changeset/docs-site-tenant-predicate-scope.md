---
"@askdb/docs-site": patch
---

The tenant docs say that each read of a scoped table needs its own predicate in its own `SELECT` (#399), drop the limits that fix closes (a predicate inside a CTE or derived table, and a mispaired subquery), and keep the join-path limit (#400). The beta.53 upgrade notes cover the change.
