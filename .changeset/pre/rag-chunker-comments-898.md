---
"@askdb/rag": patch
---

Comments only: the chunker's notes say why it still reads `Business context` and `Column notes` from the table markdown, now that `loadSchema()` carries them (#898). It drops them for sensitive tables and columns, which an opt-in index still embeds.
