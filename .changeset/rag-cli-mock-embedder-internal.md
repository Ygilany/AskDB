---
"@askdb/rag": patch
---

Internal: `createMockEmbedder` in the `askdb-rag` CLI module is no longer exported. It was never reachable through the package's `exports` map; the CLI's `--embedder mock` behavior is unchanged.
