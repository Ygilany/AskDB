---
"@askdb/introspect": minor
"@askdb/connectors": minor
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
"@askdb/prisma": patch
"askdb": patch
"@askdb/studio": patch
---

Move the connector provider registry into `@askdb/introspect` with open provider ids. Engine adapters now own connection resolution, and the CLI and Studio per-engine switches are gone (ADR 0008).

- **@askdb/introspect**:
  - New root exports: `createConnectorRegistry`, `ConnectorProviderAdapter`, `ConnectorConfig`, `ConnectorResult`, `ConnectorRegistry`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS`, `BuiltInConnectorProvider`.
  - Provider ids are typed `ConnectorProviderId = BuiltInConnectorProvider | (string & {})`, so a third-party engine can register its own id.
  - Adapters can implement `resolveConnection({ explicit?, runtime, surface? })`, which merges explicit values (CLI flags) with AskDB runtime config into `{ url?, fromExport?, schemaPath? }` (or an error). The registry adds `sourceLabel`, built from the adapter's `connectionLabelParts` with `formatConnectionLabel`, so no adapter supplies label text.
  - The registry exposes `resolveConnection(provider, request)`, `connectionLabel(provider, connection)` and `providers()`. An adapter without `connectionLabelParts` is labeled `configured <provider> connection`.
  - `createConnectorRegistry()` throws when two adapters use the same provider id, instead of silently keeping the last one.
  - `@askdb/introspect/kit` adds `defineLiveConnectorProvider` for live-catalog-only engines.
- **@askdb/connectors**: deprecated. It is now a re-export shim of the `@askdb/introspect` registry and the `@askdb/introspect/kit` connection-label helpers. `CONNECTOR_PROVIDERS` aliases `BUILT_IN_CONNECTOR_PROVIDERS`. `ConnectorProvider` aliases `ConnectorProviderId` and is now an open string type instead of a closed union. Migrate imports to `@askdb/introspect`.
- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**:
  - Each provider adapter now implements `resolveConnection`. The logic and error messages are ported from the CLI and Studio. The label keeps coming from each adapter's `connectionLabelParts`; with no schema path, the Prisma label is now `configured prisma connection` (it was the fixed text `auto-discovered prisma/schema.prisma`).
  - The adapters now take their types from `@askdb/introspect`, and the `@askdb/connectors` dependency is dropped.
  - MySQL, SQLite, and SQL Server adapters are built with `defineLiveConnectorProvider`.
- **askdb**:
  - `askdb introspect` resolves `--engine` and connections through the registry, with no per-engine switch.
  - Flag and config precedence and error messages are unchanged. The one exception: `askdb introspect templates --engine prisma` now prints the generic "does not provide SQL templates" error.
  - Drops the `@askdb/connectors` dependency.
- **@askdb/studio**:
  - The server-side introspection plan and run, and the source label, dispatch through the registry, with no per-engine switch.
  - Behavior and messages are unchanged.
  - Drops the `@askdb/connectors` dependency.
