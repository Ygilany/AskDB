---
"@askdb/http-api": minor
---

A server schema that doesn't load answers `500 generation_not_configured`, not `400 schema_parse_error` (#840). A wrong `host.schemaPath` answered any caller with a client error whose message held the server's absolute path. The message is now generic and names no path, and the `askdb.run.error` log line keeps the full `SchemaLoadError`. A request `schemaJson` that doesn't load still answers `400 schema_parse_error`.
