---
"@askdb/ai": patch
---

`@askdb/ai` cleans up its internals before 1.0 (#712), with no change to behavior or the public API. Env var lookups that chained one `first()` call per name now pass one ordered list, the Azure provider drops a single-use helper and redundant `|| undefined` fallbacks, the registry collects setup hints with a `Set`, provider names normalize through one internal helper, and JSDoc no longer describes behavior relative to earlier releases.
