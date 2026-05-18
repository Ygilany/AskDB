---
"@askdb/tui": patch
"@askdb/studio": patch
---

Running **`askdb enrich`** and **`askdb studio`** with no arguments now opens the schema directory resolved from `askdb.config` (`introspection.outputDir` → `ASKDB_INTROSPECT_OUT` env → `./askdb/`) instead of printing usage. Pass **`--schema <dir>`** to override, or **`--help`** for the command reference.
