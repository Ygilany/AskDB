---
"@askdb/docs-site": patch
---

Docs: the HTTP API reference matches a running `askdb-http`. `explain` appears in a success response only when the request asks for it (the page showed `"explain": null`). The schema comes from `--schema-path`, then `host.schemaJson`, then `host.schemaPath`. The binary's `.env` lookup order is documented, the error example shows a real `rule` code (`SQL_NOT_SELECT_OR_WITH`), and `404 not_found` covers `GET /ask`. The embed guide's Express config reads a neutral `SCHEMA_PATH`, as plan 019 requires (#713).
