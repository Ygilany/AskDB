---
"@askdb/config": patch
---

Add two `httpApi` config keys for `@askdb/http-api`:

- `httpApi.allowSchemaOverride` (default `false`) — accept per-request `schemaJson`. Must be a boolean: any other value, such as the string `"false"`, is rejected with a config error. Flattens to `ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE`.
- `httpApi.requestTimeoutMs` (default `60000`; must be a positive integer no larger than `2147483647`, the Node timer maximum, whether set in config or as `ASKDB_HTTP_REQUEST_TIMEOUT_MS` in the flat runtime map) — model-call timeout per request. Flattens to `ASKDB_HTTP_REQUEST_TIMEOUT_MS`.

Both are exposed on `getAskDbRuntimeConfig().httpApi`. `DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS` is exported.
