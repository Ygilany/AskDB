# `@askdb/connectors` (deprecated)

> **Deprecated.** The connector provider registry now lives in [`@askdb/introspect`](../introspect/README.md), and the connection-string redaction helpers live in `@askdb/introspect/kit`. See [ADR 0008](../../docs/adrs/0008-engine-packages-and-connector-registry.md). This package only re-exports them so existing imports keep working. The engine packages and the first-party apps no longer depend on it.

## Migrating

```diff
- import { createConnectorRegistry, type ConnectorConfig } from "@askdb/connectors";
+ import { createConnectorRegistry, type ConnectorConfig } from "@askdb/introspect";

- import { redactConnectionStringGeneric } from "@askdb/connectors";
+ import { redactConnectionStringGeneric } from "@askdb/introspect/kit";
```

| `@askdb/connectors` export | Replacement |
| --- | --- |
| `createConnectorRegistry`, `connectorProviderMissingMessage` | the same names from `@askdb/introspect` |
| `ConnectorConfig`, `ConnectorResult`, `ConnectorProviderAdapter`, `ConnectorProviderAdapters`, `ConnectorRegistry` | the same names from `@askdb/introspect` |
| `CONNECTOR_PROVIDERS` | `BUILT_IN_CONNECTOR_PROVIDERS` from `@askdb/introspect` |
| `ConnectorProvider` (was a closed union) | `ConnectorProviderId` from `@askdb/introspect`: an open string type (`BuiltInConnectorProvider \| (string & {})`), so third-party engines can register their own ids |
| `redactConnectionStringGeneric`, `redactUrlUserinfo`, `redactSecretKeyValues`, `isSecretConnectionKey`, `hasUrlScheme`, `REDACTED_SECRET` | the same names from `@askdb/introspect/kit` |

The registry in `@askdb/introspect` also adds `registry.providers()`, `registry.resolveConnection(provider, request)`, `registry.redactConnectionString(provider, input)`, and the optional `resolveConnection` / `redactConnectionString` adapter hooks.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
