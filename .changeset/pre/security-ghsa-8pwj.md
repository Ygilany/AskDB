---
"@askdb/core": patch
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4)). The tenant check could read some SQL differently from the database engine — a `$` inside a name, a table named after a keyword such as `user` or `lock`, an unset `backslashEscapes` on a from-scratch MySQL-family `DialectSpec`, and where a `--` comment ends — so a tenant-scoped query could pass the check without an effective tenant predicate. The check now reads each construct the way the engine does, and a test per engine confirms it on a live database. Tenant isolation enforced in the database (for example row-level security), as `SECURITY.md` recommends, still limited what such a query could read.
