---
"@askdb/docs-site": patch
---

The tenant docs say that each read of a scoped table needs its own predicate in its own `SELECT` (#399), drop the limits that fix closes (a predicate inside a CTE or derived table, and a mispaired subquery), and list the remaining limit for an unqualified predicate in an `ON` where a name is spelled like a join word. The beta.53 upgrade notes cover the change.
