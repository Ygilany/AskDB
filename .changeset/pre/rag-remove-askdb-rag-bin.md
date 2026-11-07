---
"@askdb/rag": minor
---

**Breaking:** `@askdb/rag` no longer ships the `askdb-rag` binary (#651). Since the RAG command line moved into the `askdb` package, it only printed the `askdb rag` command to run and exited `1`, and was promised for removal at 1.0. Run `npx askdb rag index`, `query` or `setup-store` from the `askdb` package instead. The package now declares `sideEffects: false`, since the binary was its only file with side effects.
