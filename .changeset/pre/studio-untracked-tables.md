---
"@askdb/core": minor
"@askdb/enrich": minor
"@askdb/rag": minor
"@askdb/studio": minor
---

Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.
