---
"@askdb/http-api": minor
---

`createAskDbHttpServer()` now loads its config when you create it, as the docs said it did (#280). Before, it never bootstrapped, so a host that didn't call `bootstrapAskDbEnv()` first got `500 internal_error` on every `POST /ask`. When no runtime snapshot is installed, the server calls `bootstrapAskDbEnv()` from `process.cwd()`, loading `.env` and `askdb.config.*`. When your process already bootstrapped, it uses that snapshot and loads nothing, so a host that bootstraps from another directory keeps its config.

Two behavior changes for hosts that embed the server:

- `createAskDbHttpServer()` throws when it has to bootstrap and finds no `askdb.config.*` in the working directory, or can't read an existing `.env`. It no longer starts a server that fails every request.
- Omitted `port` and `host` options now fall back to `httpApi.listen.port` and `httpApi.listen.host`, then to `3000` and `127.0.0.1`, the same precedence as the `askdb-http` binary. A host that sets `httpApi.listen` in its config but relied on the defaults now listens on the configured address.
