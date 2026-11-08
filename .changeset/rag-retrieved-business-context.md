---
"@askdb/rag": patch
---

`ask()`'s prompt now shows the text of a retrieved `Business context` chunk and a column chunk's `Column notes` line, through `@askdb/core`'s `synthesizeRetrievedDdl`, which `@askdb/rag` re-exports (#894). The chunks are unchanged, so an existing index needs no rebuild. A new test checks that the chunker's output reaches the prompt.
