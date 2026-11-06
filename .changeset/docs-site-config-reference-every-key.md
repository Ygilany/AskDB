---
"@askdb/docs-site": patch
---

The configuration reference now lists every `askdb.config` field, with its type, its default and whether it's required (#286). New tables cover the `introspection` connections, `rag.storeConfig`, `logging`, `host`, `dev`, `studio.listen` and `httpApi`. `dialect` lists all six built-in ids, and marks `cockroachdb` as outside the 1.0 support claim. `rag.embedder` lists its deprecated values. The `rag` and `studio` blocks are marked experimental (ADR 0030).

These claims are corrected:
- **`env()`:** it reads and trims a variable and captures nothing. `requiredEnv()` is documented.
- **The HTTP port:** `httpApi.listen.port` is a number, so the page shows `Number(env("PORT") ?? 3000)` instead of `env("PORT")`, which doesn't type-check.
- **`logging`:** the HTTP API server reads it too, and only the CLI reads `correlationId`.
- **`rag.storeConfig.file`:** the page says nothing reads `autoFlush` (#676). `basePath` defaults to `<schema dir>/schema`, not `./askdb/rag`.

The `logging.logFile` row also warns that the HTTP API server leaks a file descriptor per request (#693).
