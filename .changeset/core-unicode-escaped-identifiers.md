---
"@askdb/core": minor
"@askdb/docs-site": patch
---

`validateSelectSql()` rejects a Unicode-escaped identifier on Postgres and CockroachDB with the new rule code `SQL_UNICODE_ESCAPED_IDENTIFIER` (#692, ADR 0012). On Postgres, `U&"set\005fconfig"('app.agency_id', '2', true)` calls `set_config`, but the function denylist compared the escaped text and passed it, so every blocked function could be called this way, with or without a `UESCAPE` clause. A scoped table could be too: `SELECT id FROM U&"\006Frders"` reads `orders`, and the tenant check reported nothing (#704). The tenant check now refuses any `U&"…"` name, in any position, with the new `TenantGuardrailRuleCode` `UNICODE_ESCAPED_IDENTIFIER` (`tableId: ""`), whenever the SQL may be read as Postgres, a custom `AskDialect` included; the policy's `enforcement` decides it. A sensitive column could be hidden the same way. The check rejects `U&` (either case) written right before a `"…"` name with nothing between, rather than decoding it. `U& "x"` with a space (the `&` operator) and `U&'…'` strings still pass, and MySQL, MariaDB, SQL Server and SQLite are unchanged. `ask()`, `bindPreparedQuery()` and Studio's Execute reject the same SQL, since they run `validateSelectSql()`.

**Upgrade notes:** a `switch` that lists every `SqlValidationRuleCode` or `TenantGuardrailRuleCode` needs the new case. Stored SQL that uses a `U&"…"` name is now rejected at rebind: write the name in plain double quotes.

The docs add both rules to Safety boundaries, the `core-api` error tables, Troubleshooting and the tenant-policy contract. "Enforce tenancy in the database" and `/AGENTS.md` now say that AskDB's checks reject `set_config`, including a Unicode-escaped spelling, and that the database revoke is still the boundary.
