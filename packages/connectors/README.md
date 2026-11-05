# `@askdb/connectors` (deprecated)

> **Deprecated.** The connector provider registry now lives in [`@askdb/introspect`](../introspect/README.md), and the connection-label helpers live in `@askdb/introspect/kit`. See [ADR 0008](../../docs/adrs/0008-engine-packages-and-connector-registry.md). This package only re-exports them so existing imports keep working. The engine packages and the first-party apps no longer depend on it.

## Migrating

```diff
- import { createConnectorRegistry, type ConnectorConfig } from "@askdb/connectors";
+ import { createConnectorRegistry, type ConnectorConfig } from "@askdb/introspect";

- import { formatConnectionLabel } from "@askdb/connectors";
+ import { formatConnectionLabel } from "@askdb/introspect/kit";
```

| `@askdb/connectors` export | Replacement |
| --- | --- |
| `createConnectorRegistry`, `connectorProviderMissingMessage` | the same names from `@askdb/introspect` |
| `ConnectorConfig`, `ConnectorConnection`, `ConnectorResult`, `ConnectorProviderAdapter`, `ConnectorProviderAdapters`, `ConnectorRegistry` (including `connectionLabel`; the `connectionLabelParts` hook is on `ConnectorProviderAdapter`) | the same names from `@askdb/introspect` |
| `CONNECTOR_PROVIDERS` | `BUILT_IN_CONNECTOR_PROVIDERS` from `@askdb/introspect` |
| `ConnectorProvider` (was a closed union) | `ConnectorProviderId` from `@askdb/introspect`: an open string type (`BuiltInConnectorProvider \| (string & {})`), so third-party engines can register their own ids |
| `formatConnectionLabel`, `parseConnectionUrl`, `ConnectionLabelParts` | the same names from `@askdb/introspect/kit` |

The registry in `@askdb/introspect` also adds `registry.providers()`, `registry.resolveConnection(provider, request)` (whose `sourceLabel` the registry builds from the adapter's `connectionLabelParts`), and the optional `resolveConnection` adapter hook.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
