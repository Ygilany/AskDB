---
"@askdb/core": patch
---

Make the dialect-id switches exhaustive over `BuiltInDialectId` (#661): the tenant check's per-engine reading is now a `Record<BuiltInDialectId, …>`, and `lexerProfileFor` and `selectModifiersFor` fail the type check for a built-in id with no case. The deliberate fail-closed defaults are unchanged — an id that is no built-in engine still gets no lexer profile, every engine's SELECT modifiers, and every reading. Adds a test looping over `SUPPORTED_DIALECT_IDS` (lexer profile, quoting, marker style, SELECT modifiers, tenant reading) and a drift test in `@askdb/client` that `ASKDB_DIALECTS` matches `SUPPORTED_DIALECT_IDS`.
