---
"@askdb/core": patch
"@askdb/studio": patch
---

**@askdb/core**: `ask()` now passes its dialect to `validateSensitiveReferences`, so the sensitive-column check lexes the returned SQL the way the target engine does instead of unioning every engine's reading. Custom `AskDialect`s (no `DialectSpec`) keep the conservative union. Tenant placeholder substitution (`resolveTenantSql`, `extractTenantPlaceholders`, `resolvePlaceholders`) also uses the dialect's lexer, so a `:tenant_*_ids` placeholder inside a MySQL backslash-escaped string literal or a MySQL `#` comment is left untouched, matching `bindPreparedQuery`.

**@askdb/studio**: Playground execute's sensitive-column warnings lex the SQL with the execute engine's dialect.
