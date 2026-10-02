---
"@askdb/http-api": minor
---

Harden `POST /ask` error handling, sensitivity, and schema overrides.

- **Errors map by type.** Before, any error whose message contained "mode" returned `400`. That included every model-provider failure ("Model call failed: …"), which also sent the provider's raw text to the client and skipped logging. Now `SqlGenerationError` returns `502 sql_generation_error` with a generic message. `SensitiveReferenceError` and `TenantGuardrailError` map to `422 guardrail_violation`, though the server can't raise either today (it runs the sensitive check in warn mode and can't pass a tenant scope, so a tenant-policy schema returns `500`). Unknown errors return a generic `500 internal_error`. Provider error text is never returned. Every non-`2xx` `POST /ask` response, including an early `400`/`403`/`413` rejection, is logged as `askdb.run.error` with its `status` and `code` under the response's `correlationId`; failures inside `ask()` also log the full error. The exception is a last-resort `500` for an error that escapes the handler, which is written to stderr.
- **`mode` is validated up front.** An invalid body `mode` or `x-askdb-mode` header returns `400 bad_request`.
- **Config `modes.omitSensitiveFromPrompt` is honored.** A request's `omitSensitiveFromPrompt` can tighten it but not loosen it.
- **Breaking: `omitSensitiveFromPrompt` must be a boolean.** A string or number (`"true"`, `1`) used to count as "omit"; it now returns `400 bad_request` instead of reaching the model.
- **`sensitiveGuardrail` is returned** in the success response when the schema marks something `sensitive`.
- **Breaking: per-request `schemaJson` is off by default.** A request that sends it now gets `403 schema_override_disabled`. Set `httpApi.allowSchemaOverride: true` to accept overrides again.
- **Model-call timeout.** Controlled by `httpApi.requestTimeoutMs` (default `60000`, at most `2147483647`). A timed-out request returns `502`.
- **Cleaner startup errors.** `askdb-http` prints a one-line error and exits `1` when it can't bind (e.g. `EADDRINUSE`) or can't load config. Before, it printed a raw stack trace.
- **Fixed `generation_not_configured` hint.** It now points to `ai.providerConfig` / `dev.mockSql` instead of `ASKDB_MOCK_SQL`, which the server does not read from the environment.
