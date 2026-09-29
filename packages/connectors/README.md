# `@askdb/connectors`

AskDB connector provider registry for app/bootstrap wiring. Maps config-driven introspection provider selections to concrete connector packages (`@askdb/postgres`, `@askdb/mysql`, etc.), following the same registry pattern as `@askdb/ai`.

## Install

```bash
pnpm add @askdb/connectors
# Plus the connector provider packages your runtime uses:
pnpm add @askdb/postgres @askdb/mysql @askdb/sqlite @askdb/sqlserver @askdb/prisma
```

Install only the concrete connector packages your introspection config requires.

## Usage

```ts
import { createConnectorRegistry, type ConnectorConfig } from "@askdb/connectors";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { introspect } from "@askdb/introspect";

const registry = createConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
]);

const { connector, input } = registry.createConnector({
  provider: "postgres",
  url: "postgres://localhost/mydb",
});

const result = await introspect(input, { outDir: "./askdb", schemaId: "mydb" }, { connector });
```

## Exports

- `createConnectorRegistry` — registry factory
- `CONNECTOR_PROVIDERS` — constant array of all provider ids
- `ConnectorProvider` — `"postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"`
- `ConnectorConfig` — unified per-call config shape
- `ConnectorResult` — `{ connector, input, mode }` pair consumed by `introspect()`
- `ConnectorProviderAdapter` — interface implemented by each concrete package, with an optional `connectionLabelParts(connection)` hook
- `ConnectorConnection` — `{ url?, fromExport?, schemaPath? }`, the source fields of `ConnectorConfig`
- `ConnectorRegistry` — `{ hasProvider, createConnector, getTemplates, connectionLabel }`
- `connectorProviderMissingMessage` — actionable error helper

### Connection labels

`registry.connectionLabel(provider, connection)` returns a credential-free label for display or logs. It is always `formatConnectionLabel(provider, parts)`, where `parts` come from the adapter's optional `connectionLabelParts(connection)` hook: the host, port and database (or a file path) that the engine's own parser extracts cleanly. An adapter never returns label text, so a label is never built by masking the raw string, and a provider without the hook, or a connection that doesn't parse, gets `configured <provider> connection` ([ADR 0011](../../docs/adrs/0011-connection-labels-from-parsed-parts.md)).

```ts
const registry = createConnectorRegistry([postgresConnectorProvider]);
registry.connectionLabel("postgres", { url: "postgres://app:S3cret@db:5432/app" }); // "postgres://db:5432/app"
```

The helpers engine parsers use:

- `formatConnectionLabel(engine, parts)` — `<engine>://host[:port][/database]` for `{ host?, port?, database? }`, the path for `{ file }`; `configured <engine> connection` when `parts` is `undefined` or any part fails its allowlist
- `parseConnectionUrl(input, schemes)` — parses a standard `scheme://[userinfo@]host[:port][/database][?query]` URL into `{ host, port, database }` (userinfo and query are never returned); `undefined` for another scheme, whitespace, a `#`, an `@` after the authority, or a multi-segment path
- `ConnectionLabelParts`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
