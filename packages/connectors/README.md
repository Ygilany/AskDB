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
- `ConnectorProviderAdapter` — interface implemented by each concrete package
- `ConnectorRegistry` — `{ hasProvider, createConnector, getTemplates }`
- `connectorProviderMissingMessage` — actionable error helper

### Connection labels

Helpers the engine packages build their `connectionLabel()` on (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlserver`, `@askdb/sqlite` each export one that parses its own connection-string formats). A label is built only from parts that parse cleanly, never by masking the raw string ([ADR 0011](../../docs/adrs/0011-connection-labels-from-parsed-parts.md)).

- `formatConnectionLabel(engine, parts)` — `<engine>://host[:port][/database]` for `{ host?, port?, database? }`, the path for `{ file }`; `configured <engine> connection` when `parts` is `undefined` or any part fails its allowlist
- `parseConnectionUrl(input, schemes)` — parses a standard `scheme://[userinfo@]host[:port][/database][?query]` URL into `{ host, port, database }` (userinfo and query are never returned); `undefined` for another scheme, whitespace, a `#`, an `@` after the authority, or a multi-segment path
- `ConnectionLabelParts`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
