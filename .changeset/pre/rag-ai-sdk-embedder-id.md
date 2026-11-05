---
"@askdb/rag": minor
"@askdb/studio": patch
---

`@askdb/rag` exports `aiSdkEmbedderId({ provider, model, dimensions })`, the `embedderId` an index records when it's embedded through an AI SDK model built from an `ai.embedding` section: `ai-sdk:<provider>:<model>:<dimensions>`, ending in `default` when no width was requested. Studio and `askdb rag` now both build their ids with it, so the promise that either accepts an index the other built no longer rests on two copies of the format. Studio's ids are unchanged.
