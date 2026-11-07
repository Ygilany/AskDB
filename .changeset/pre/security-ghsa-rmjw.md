---
"@askdb/core": patch
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-rmjw-pffc-5hjr](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rmjw-pffc-5hjr)), a residual of [GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4) finding 1. The tenant check read a dollar-quoted string whose tag holds non-ASCII letters (`$é$ … $é$`) as code, where Postgres, CockroachDB and the shared lexer read it as a string, so a tenant-scoped query could pass the check without an effective tenant predicate. The check's scanner now reads the tag with the same character set as the shared lexer and the engine. Enforce tenant isolation in the database (for example row-level security) regardless.
