---
"@askdb/docs-site": patch
---

The HTTP API reference documents what `createAskDbHttpServer()` returns (`{ host, port, server, listen(), close() }`, with `listen()` and `close()` returning promises), the real `port`/`host` precedence (option, then `httpApi.listen.*`, then the default), and a new "Config loading" section: the server uses the host's bootstrapped config, or loads `.env` and `askdb.config.*` from the working directory itself. The deploy guide awaits `listen()`. The config and package references list `isAskDbRuntimeInitialized()` (#280).
