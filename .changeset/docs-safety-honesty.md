---
"@askdb/core": patch
---

**@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) no longer claims it "falls back to conservative rejection". It now says what the check does: a best-effort lint that confirms expected tenant identifiers appear in the SQL text. It is not a SQL parser and not a security boundary. The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.
