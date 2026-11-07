---
"@askdb/docs-site": patch
---

Docs: a new "@askdb/ai API reference" lists every export of `@askdb/ai`, including the registry's methods, the built-in providers and their SDKs, a working custom adapter, the env-map precedence and the errors, with a diagram of how settings become a model. A new how-to, "Bundle an app that uses AskDB", covers esbuild and webpack 5: keep `@askdb/config` out of the bundle and install it next to it, or use no config file; the `createRequire` banner esbuild's ESM output needs; and shipping the schema as one JSON file. The packages page's `@askdb/ai` section becomes a pointer (#713). Example variable names in the config reference, the RAG guide and the database-tenancy guide are neutral again, such as `PGVECTOR_URL`, as plan 019 requires.
