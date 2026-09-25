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

### Connection-string redaction

Display/logging helpers the engine packages build their `redactConnectionString()` on
(`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlserver`, `@askdb/sqlite` each export one that
knows its own formats). Output is for humans only — never pass it back to a driver.

These now live in `@askdb/introspect/kit` and are re-exported here unchanged for compatibility;
new code should import them from `@askdb/introspect/kit`.

- `redactConnectionStringGeneric(input)` — masks URL userinfo passwords and secret `key=value`
  pairs (`?password=`, JDBC-style `;password=`, ADO.NET `Password=` / `Pwd=`); the fallback for
  providers without a dedicated redactor
- `redactUrlUserinfo(input)` — `scheme://user:secret@host` → `scheme://user:****@host`
- `redactSecretKeyValues(input, { separators?, whitespaceSeparated? })` — masks secret
  `key=value` pairs; quote- and `{brace}`-aware
- `isSecretConnectionKey(key)`, `hasUrlScheme(input)`, `REDACTED_SECRET`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
