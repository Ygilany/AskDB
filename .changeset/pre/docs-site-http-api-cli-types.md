---
"@askdb/docs-site": patch
---

The HTTP API reference documents `askdb-http -h`/`--help`, the exit code `1` for a wrong flag (an unknown flag, a missing value, an invalid `--port`), and the four exported types: `AskDbHttpServerOptions`, `AskHttpRequest`, `AskHttpSuccessResponse` and `AskHttpErrorResponse` (#285). The export check now covers `@askdb/http-api` too.
