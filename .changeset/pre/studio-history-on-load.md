---
"@askdb/studio": patch
---

Studio loads the saved Playground history when it starts. The Overview's **Recent playground queries** and the Playground's **History** used to stay empty until the first ask or delete of the session, even when `playground-history.json` had entries (closes #1046).
