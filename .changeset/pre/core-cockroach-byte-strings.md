---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The checks refuse a `b'…'` byte string (lower-case `b`) that holds a backslash or is continued on a later line (#730, ADR 0012). CockroachDB reads `b'…'` with backslash escapes, and the checks read it without them, so under the `cockroachdb` dialect `SELECT b'\'' AS x, o.* FROM orders o --'` passed all three checks while CockroachDB ran an unscoped read of `orders`. The read-only check refuses it on Postgres, CockroachDB and a dialect id that is no built-in engine, as `SQL_ESCAPED_BYTE_STRING`. The tenant check (`ESCAPED_BYTE_STRING`, `tableId: ""`) and the sensitive check (the `SensitiveScopeIssue` `ESCAPED_BYTE_STRING`) also cover a custom `AskDialect`, which skips the read-only check, and a call with no dialect. The lexer also reads `:b'…'` (an array slice's `:`) as `:` and a byte string.

**Upgrade notes:** a `switch` over `SqlValidationRuleCode`, `TenantGuardrailRuleCode` or `SensitiveScopeIssue` needs a case for the new member. Write bytes with escapes as a hex string cast to `bytea` (`'\x00'::bytea`), which Postgres and CockroachDB both read as bytes; a `b'…'` string with no backslash, and a `B'…'` bit string, still pass.

The docs add the codes to the `core-api` error tables, Safety boundaries, Troubleshooting, the multi-tenancy guide, the upgrade guide, SECURITY.md and the tenant and sensitive-fields contracts.
