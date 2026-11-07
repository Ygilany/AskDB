---
"@askdb/http-api": minor
---

With no schema configured server-side, `askdb-http` answers `500 generation_not_configured`, not `400 bad_request` (#845). No `--schema-path`, `host.schemaJson` or `host.schemaPath` is the operator's to fix, like a server schema that doesn't load (#840), so the message is generic and the `askdb.run.error` log line's `errName` (`SchemaNotConfiguredError`) names the cause. A request that sends its own `schemaJson` is unaffected.
