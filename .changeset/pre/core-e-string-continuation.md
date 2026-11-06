---
"@askdb/core": minor
"@askdb/docs-site": patch
---

`validateSelectSql()` rejects an `E'…'` string continued on a later line on Postgres, CockroachDB, and a dialect id that is no built-in engine, with the new rule code `SQL_STRING_CONTINUATION`, and the tenant check reports it as the new `TenantGuardrailRuleCode` `STRING_CONTINUATION` (`tableId: ""`) (#703, ADR 0012). Postgres joins `E'a'`, a newline and `'…'` into one constant and keeps the escape mode, while AskDB's lexer read the second part in plain mode. So `SELECT E'a'`, a newline, then `'\'' AS x, o.* FROM orders o --'` read as three strings to AskDB and as an unscoped read of `orders` to Postgres, and passed both checks under the built-in `postgres` dialect. The checks now refuse an `E'…'` string followed by a gap with a newline (whitespace and comments of any kind) and then a bare `'…'`, rather than model the continuation. The lexer also reads `:E'…'` (a `JSON_OBJECT` key's or an array slice's `:`) as `:` and an escape string, where it used to read a `:E` placeholder and hid the string. The new messages give the string's offset, not its text. The read-only check runs this first. The tenant check applies it whenever the SQL may be read as Postgres, a custom `AskDialect` included, and the policy's `enforcement` decides it. A plain string continued on the next line, and `E'a' || 'b'`, still pass. MySQL, MariaDB, SQL Server and SQLite are unchanged.

**Upgrade notes:** a `switch` that lists every `SqlValidationRuleCode` or `TenantGuardrailRuleCode` needs the new case. Stored SQL that continues an `E'…'` string is now rejected at rebind: join the parts with `||`.

The docs add both rules to Safety boundaries, the `core-api` error tables, Troubleshooting, the multi-tenancy guide and the tenant-policy contract.
