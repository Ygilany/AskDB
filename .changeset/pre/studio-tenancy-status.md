---
"@askdb/studio": patch
---

Studio's Tenancy screen shows the messages it used to drop, and keeps a label you typed (closes #1051, closes #1055).

- **Messages:** after an AI draft, the review screen says `AI draft ready for review.` After a save, or a saved edit, the summary says `Tenant policy saved.` Both used to be set on a screen that had already been replaced.
- **Label:** in **Configure manually**, picking or changing the root table fills **Label** with the table's name only while you haven't typed one. A label you typed used to be replaced.
