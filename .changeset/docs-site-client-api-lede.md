---
"@askdb/docs-site": patch
---

The `@askdb/client` API reference no longer says `createAskDb()` resolves the dialect once (it resolves it on every call), and links the client-or-core choice to the Bring your own model guide instead of repeating it (#713). The embed guide and the Bring your own model guide no longer say the client is limited to one schema: a call can pass its own `schema`.
