---
"@askdb/docs-site": patch
---

Make askdb.tools negotiate content for agents. A Cloudflare Worker in `apps/docs-site/edge/` serves a page's Markdown twin when a request prefers `text/markdown`, with `Vary: Accept`, and answers a missing path with a Markdown 404 body (also at `/404.md`) or, for `application/json`, a JSON error with a hint and links. The site also publishes `/openapi.json`, an OpenAPI 3.1 document of the self-hosted `askdb-http` API, checked against the server's routes and error codes at build time and linked from the HTTP API reference.
