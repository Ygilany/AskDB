---
"@askdb/core": patch
"@askdb/http-api": patch
"@askdb/docs-site": patch
---

`createAskDbLogger()` opens each `logFile` path once per process and shares it across loggers, instead of opening it again for every logger (#693). Hosts build a logger per request, so the HTTP API server leaked one file descriptor per `POST /ask` with `logging.logFile` set, until it ran out of descriptors and stopped serving. The file now stays open for the life of the process. Rotate it with `copytruncate`, or restart the process after a rotate. The configuration and core API references and the upgrade guide say so.
