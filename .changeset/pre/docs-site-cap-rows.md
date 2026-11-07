---
"@askdb/docs-site": patch
---

New how-to, Cap the rows a query returns (`guides/cap-the-rows-a-query-returns`), under Guides → Run in production (#713). It holds the row-cap helpers that were in Run safely in production, as four steps: read one row more than you show, add `runCapped` for your engine, call it with `ask()`'s result, and show that the result was cut. Step 3 shows a tenant-scoped call with `result.tenantParams`, and a call without a tenant scope, which has none. The SQL Server helper now says `DATABASE_URL` must be an ADO.NET string, which is all `mssql` reads. Run safely in production keeps its Row limits heading, so existing links still land, with a short pointer to the new page.
