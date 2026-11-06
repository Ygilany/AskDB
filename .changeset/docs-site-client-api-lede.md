---
"@askdb/docs-site": patch
---

The `@askdb/client` API reference no longer says `createAskDb()` resolves the dialect once (it resolves it on every call), and links the client-or-core choice to the Bring your own model guide instead of repeating it (#713). The rest of the page was checked against `packages/client/src` and matches.
