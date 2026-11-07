---
"askdb": minor
---

**Breaking:** `askdb rag --embedder openai` and `--embedder ai-sdk` are removed (#811), as the same `rag.embedder` values were in 1.0.0-beta.50 (#765). They were deprecated aliases of `--embedder ai` since 1.0.0-beta.44, promised for removal at 1.0. Each now fails with exit code `1` before the command reads the schema or opens a store, with an error naming the replacement: `--embedder ai`, with `rag.embedder: "ai"` and an `ai.embedding` section in `askdb.config.*`. An index the aliases built keeps its embedder id, since they embedded with `ai.embedding` too.
