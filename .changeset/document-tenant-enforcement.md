---
"@askdb/docs-site": patch
---

A new guide, Enforce tenancy in the database, makes Postgres row-level security the tenant boundary for generated SQL (#234). It covers policies keyed on a per-request setting that fail closed when the setting is unset and take many tenant IDs, revoking `set_config` from `PUBLIC` so the generated SQL can't change its own tenant (with the grant-back step and a check query), the owner, superuser, view, materialized-view and `SECURITY DEFINER` bypasses, a node-postgres transaction that sets the tenant with `SET LOCAL` and runs the SQL as one statement, the checks that show the setup works, and what CockroachDB, SQL Server, MySQL, MariaDB and SQLite offer instead. Multi-tenancy gains a "What enforces isolation" section, and Run safely in production, Safety boundaries and How AskDB works link the guide.
