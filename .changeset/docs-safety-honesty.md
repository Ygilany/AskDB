---
"@askdb/core": patch
"@askdb/docs-site": patch
"askdb": patch
"@askdb/http-api": patch
---

**@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) no longer claims it "falls back to conservative rejection". It now says what the check does: a best-effort lint that confirms expected tenant identifiers appear in the SQL's code (outside string literals and comments). It is not a SQL parser and not a security boundary; `... OR 1=1` still passes. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

**@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

**askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.
