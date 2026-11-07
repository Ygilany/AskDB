---
"@askdb/core": minor
---

A join counts in the tenant check only on the columns the policy declares (#400). A table scoped through a join path needs each hop to equate the declared columns (`appointments.client_id = clients.id`), as a `col = col` conjunct or `col IN (SELECT col …)` on the reads actually joined, in the same `SELECT`, up to a read filtered with an allowed root's placeholder. A root the scope covers, filtered through another table's column, needs the join on its ID column. A join on any other pair of columns links nothing. A scoped table's tenant column joined to a filtered root's ID, or `IN (SELECT id FROM <root> WHERE id = :p)`, now passes.

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` (`MISSING_TENANT_PREDICATE`) under `strict`: a join-path table joined on other columns or not joined, a covered root cross-joined or joined on another column to a filtered table, and a join through a CTE or derived table, which the check doesn't follow. Join on the declared columns in the same `SELECT`, or filter the read where it is.
