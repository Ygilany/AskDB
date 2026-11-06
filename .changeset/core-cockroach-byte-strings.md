---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The read-only, tenant and sensitive checks refuse a `b'…'` byte string (lower-case `b`) that holds a backslash or is continued on a later line, whenever the SQL may be read as Postgres (#730, ADR 0012). CockroachDB reads `b'…'` with backslash escapes, and the checks read it without them, so under the `cockroachdb` dialect `SELECT b'\'' AS x, o.* FROM orders o --'` passed all three checks while CockroachDB ran an unscoped read of `orders`. The new codes are `SQL_ESCAPED_BYTE_STRING` (read-only check), `ESCAPED_BYTE_STRING` (tenant check, `tableId: ""`) and the `SensitiveScopeIssue` `ESCAPED_BYTE_STRING`. The lexer also reads `:b'…'` (an array slice's `:`) as `:` and a byte string.

**Upgrade notes:** a `switch` over `SqlValidationRuleCode`, `TenantGuardrailRuleCode` or `SensitiveScopeIssue` needs a case for the new member. Write bytes with escapes as a hex literal (`x'00'`); a `b'…'` string with no backslash, and a `B'…'` bit string, still pass.

The docs add the codes to the `core-api` error tables, Safety boundaries, Troubleshooting, the multi-tenancy guide, the upgrade guide and the tenant and sensitive-fields contracts.
