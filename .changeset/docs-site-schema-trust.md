---
"@askdb/docs-site": patch
---

The HTTP service guide, the HTTP API and config references, and Safety boundaries say that a schema, including a per-request `schemaJson` override, is input AskDB parses, so it must come from a trusted source. They name the `@askdb/http-api` release that carries the fixed `@askdb/core` for GHSA-qqx9-qpw2-wcqg, and the beta.48 upgrade note links the advisory.
