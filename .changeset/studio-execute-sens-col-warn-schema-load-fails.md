---
"@askdb/studio": patch
---

Studio Execute now warns when the sensitive-column check cannot run because the schema fails to load, carrying the load error's message, instead of silently returning no warning. The query still runs (#663).
