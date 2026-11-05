---
"@askdb/ai": minor
"@askdb/introspect": minor
"@askdb/core": patch
---

Remove the deprecated `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic` and `@askdb/connectors` packages. They are no longer published or fixed. Their last versions stay on npm (`@askdb/ai-openai`, `-azure` and `-google` 1.0.0-beta.8, `@askdb/ai-anthropic` 1.0.0-beta.6, `@askdb/connectors` 0.1.0-beta.9), so existing installs keep working.

**Breaking** for code that still imports one of them. Install and import these instead:

- `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`: install `@askdb/ai` and the matching AI SDK package (`@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google` or `@ai-sdk/anthropic`). `createAskDb({ config })` and `createAiRegistry()` register every built-in provider, so drop `providers: [openaiProvider]`, or pass names such as `providers: ["openai"]` to restrict the set. `openaiProvider`, `azureProvider`, `googleProvider` and `anthropicProvider` are exported from `@askdb/ai`.
- `@askdb/connectors`: import `createConnectorRegistry`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS` and the `Connector*` types from `@askdb/introspect`, and `formatConnectionLabel`, `parseConnectionUrl` and `ConnectionLabelParts` from `@askdb/introspect/kit`. `CONNECTOR_PROVIDERS` becomes `BUILT_IN_CONNECTOR_PROVIDERS`, and `ConnectorProvider` becomes `ConnectorProviderId`.

`@askdb/core`'s README no longer lists `@askdb/connectors` among the packages that need `ai` installed.
