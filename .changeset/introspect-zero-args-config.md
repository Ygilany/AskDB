---
"askdb": patch
---

Running **`askdb introspect`** with no extra arguments now performs a Postgres introspection using **`DATABASE_URL`** and **`ASKDB_INTROSPECT_OUT`** from the bootstrapped `askdb.config` snapshot instead of printing usage. Use **`--help`** for the command reference.
