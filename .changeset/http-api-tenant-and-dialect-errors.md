---
"@askdb/http-api": minor
---

**`askdb-http` refuses a schema whose `provider` has no AskDB dialect, and names a tenant-policy schema's error** (#720, #716). The server built its client with `unknownDialect: "fallback-postgres"`, so a schema recorded by an engine AskDB doesn't ship, such as Snowflake, got PostgreSQL SQL with `200`, checked under PostgreSQL's rules, while `askdb ask` refused it. The server now refuses it. The server's configured schema answers `500 generation_not_configured`, with a generic message, and the log's `errName` (`DialectNotSupportedError`) tells it apart from a missing model. A request `schemaJson` answers `400 bad_request`. A schema with a tenant policy, which the server can't scope (#343), now answers `500 tenant_scope_not_configured`, a new error code, instead of the generic `500 internal_error`. It still returns no SQL and never calls the model. A `TenantScopeError` with any other reason stays the generic `500`.
