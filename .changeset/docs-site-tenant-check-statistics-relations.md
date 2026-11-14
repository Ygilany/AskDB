---
"@askdb/docs-site": patch
---

The docs say the tenant check refuses a Postgres planner-statistics relation (`pg_stats`, `pg_statistic` and the extended-statistics ones) wherever the SQL names it, under every dialect: the core API reference's `UNCHECKABLE_RELATION` rule row and the tenant policy reference's "What the tenant check requires".
