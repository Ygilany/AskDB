---
"@askdb/core": patch
---

`ask()` and `bindPreparedQuery()` now render a checked template through one internal module (#711), so a fix to how either form renders reaches both. The public API is unchanged. The JSDoc on `ask()`'s `retriever` option now says it runs whenever it is supplied: the `retrievalThresholdChunks` threshold applies only when the host passes `totalSchemaChunkCount`.

`ask()` now re-checks the reuse forms it renders, as `bindPreparedQuery()` does, and drops `unboundSql`, `params`, `parameters` and `preparedQuery` (keeping `sql`) if one still holds a placeholder or fails the read-only check: for example an `unboundSql` with a raw `:tenant_<root>_ids` placeholder under a schema with no tenant policy.
