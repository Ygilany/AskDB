---
"@askdb/client": minor
---

`AskDbClient` gains `bind(prepared, values, options?)`, returning `Promise<BoundQuery>` (ADR 0010, #310). It rebinds a stored `preparedQuery` without calling the model: it resolves the schema the way `ask()` does (per-call `options.schema`, then the client default, then `host.schemaJson` / `ASKDB_SCHEMA_JSON`, then `host.schemaPath` / `ASKDB_SCHEMA_PATH`), expands a `subtree` `tenantScope` with core's `expandTenantScope()` and `options.resolveTenantDescendants`, and forwards to `@askdb/core`'s `bindPreparedQuery()`, which re-checks the template under that schema, scope and modes. The options type, `BindOptions` (`{ tenantScope?, resolveTenantDescendants?, sensitiveGuardrailMode?, acceptWarnings?, schema? }`), is exported. Use it in place of calling core's `bindPreparedQuery()` with a hand-loaded schema.
