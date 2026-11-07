---
"@askdb/docs-site": patch
---

The HTTP API docs say a request `schemaJson` gets SQL for its own `provider`, and `400 bad_request` when it records none or one AskDB has no dialect for, while the config's `dialect` applies to the server's own schema only (#809): the HTTP API reference, the config reference's `dialect` row, the deploy guide and the beta.50 upgrade entry.
