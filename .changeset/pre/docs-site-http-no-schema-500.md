---
"@askdb/docs-site": patch
---

The HTTP API reference says a server with no schema configured answers `500 generation_not_configured`, not `400 bad_request`, in its Schema bullet and its `bad_request` and `generation_not_configured` rows, with a beta.51 upgrade note (#845).
