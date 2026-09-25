---
"@askdb/introspect": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

Remove test-only driver-cache seams: `OptionalDriverLoader.reset()` in `@askdb/introspect/kit` and the internal `__reset*ModuleCacheForTests()` functions in the engine packages' `exec` modules. They had no production callers and were not exported from any package entry point.
