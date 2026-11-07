---
"@askdb/http-api": patch
"@askdb/enrich": patch
"@askdb/prisma": patch
"@askdb/rag": patch
"@askdb/postgres": patch
---

The READMEs and doc comments say "schema artifact" or "schema directory" instead of "Schema v2" (#273): the http-api `schemaJson` request field's doc comment and README, and the enrich, prisma and rag READMEs. A `@askdb/postgres` connector comment no longer names an internal `ASKDB_*` key (#629).
