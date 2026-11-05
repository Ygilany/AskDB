---
"@askdb/introspect": minor
---

`createConnectorRegistry()` accepts **lazy entries** next to adapters: `{ provider, load }`, where `load()` imports an engine package the host may not have installed and returns its adapter (`LazyConnectorProviderAdapter`, `ConnectorProviderEntry`). `hasProvider()` and `providers()` list a lazy entry without loading it. The new `registry.load(provider)` imports it once (concurrent calls share the import, and a failed one is retried), rejects an adapter whose `provider` differs from the entry's, and resolves an adapter object as it is. Until an entry is loaded, `createConnector`, `resolveConnection`, `getTemplates` and `connectionLabel` throw for it instead of falling back. `connectorPackageMissingMessage({ provider, packageName })` gives the install hint for a missing engine package. A registry of adapters only behaves as before. See ADR 0008's 2026-11-05 amendment.
