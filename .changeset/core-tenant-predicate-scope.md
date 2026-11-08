---
"@askdb/core": minor
---

The tenant check ties each predicate to the reads it filters (#399). Each CTE body, derived table, subquery and set-operation branch is its own `SELECT`, a read of a scoped table or covered root needs its own predicate there, and a qualified predicate counts only for the read it names. A predicate inside a CTE or derived table no longer covers an unfiltered read of the same table outside it, and a predicate on one reference no longer covers another.

Upgrade notes (breaking): some SQL that passed now throws `TenantGuardrailError` (`MISSING_TENANT_PREDICATE`) under `strict`, correct queries included; the beta.53 section of the upgrade guide lists them, with the change each needs.
