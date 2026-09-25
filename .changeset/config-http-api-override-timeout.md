---
"@askdb/config": patch
---

Add two `httpApi` config keys for `@askdb/http-api`:

- `httpApi.allowSchemaOverride` (default `false`) — accept per-request `schemaJson`. Flattens to `ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE`.
- `httpApi.requestTimeoutMs` (default `60000`; must be a positive integer) — model-call timeout per request. Flattens to `ASKDB_HTTP_REQUEST_TIMEOUT_MS`.

Both are exposed on `getAskDbRuntimeConfig().httpApi`. `DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS` is exported.
