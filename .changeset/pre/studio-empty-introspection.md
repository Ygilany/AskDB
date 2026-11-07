---
"@askdb/studio": patch
---

Studio's introspection and resync answer 422 with the reason when the source has no tables or views to write (#337, ADR 0037), instead of writing an artifact Studio then can't load. The artifact on disk stays as it was.
