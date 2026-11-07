---
"@askdb/docs-site": patch
---

The upgrade guide's beta.50 section covers the three leftovers removed before rc.1 (#651, #811): the env path's default embedding model, the `askdb-rag` binary and the `askdb rag --embedder openai|ai-sdk` values. Its deprecation table now dates each removal to 1.0.0-beta.50, and "Check the upgrade" no longer mentions the removed `ASKDB_AI_DEFAULT_EMBEDDING_MODEL` warning. The CLI reference, the packages reference's env precedence table and `@askdb/ai`'s README match.
