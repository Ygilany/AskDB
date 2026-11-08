---
"@askdb/docs-site": patch
---

The configuration reference's `dialect` row and the modes-and-dialects page no longer name Studio as an exception: Studio refuses a schema whose engine AskDB ships no dialect for, as the CLI and the HTTP API do (#886). The client reference documents `resolveDialect()`, the Studio page says what Get the code shows for such a schema, and the upgrade guide's beta.52 section covers the change.
