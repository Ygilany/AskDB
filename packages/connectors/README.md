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
import { createAskDbConnectorRegistry, type AskDbConnectorConfig } from "@askdb/connectors";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { introspect } from "@askdb/introspect";

const registry = createAskDbConnectorRegistry([
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

- `createAskDbConnectorRegistry` — registry factory
- `ASKDB_CONNECTOR_PROVIDERS` — constant array of all provider ids
- `AskDbConnectorProvider` — `"postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"`
- `AskDbConnectorConfig` — unified per-call config shape
- `AskDbConnectorResult` — `{ connector, input, mode }` pair consumed by `introspect()`
- `AskDbConnectorProviderAdapter` — interface implemented by each concrete package
- `askDbConnectorProviderMissingMessage` — actionable error helper

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
