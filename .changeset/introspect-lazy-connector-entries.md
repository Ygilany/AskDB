---
"@askdb/introspect": minor
---

`createConnectorRegistry()` accepts **lazy entries** next to adapters: `{ provider, load }`, where `load()` imports an engine package the host may not have installed and returns its adapter (`LazyConnectorProviderAdapter`, `ConnectorProviderEntry`). `hasProvider()` and `providers()` list a lazy entry without loading it. The new `registry.load(provider)` imports it once (concurrent calls share the import, and a failed one is retried), rejects an adapter whose `provider` differs from the entry's, and resolves an adapter object as it is. Until an entry is loaded, `createConnector`, `resolveConnection`, `getTemplates` and `connectionLabel` throw for it instead of falling back. `connectorPackageMissingMessage({ provider, packageName, allowBuilds })` gives the `askdb` CLI's and Studio's install hint for a missing engine package, with the pnpm build approvals it needs. A registry of adapters only behaves as before. See ADR 0008's 2026-11-05 amendment.

The kit's `createOptionalDriverLoader` no longer says to install a driver that is on disk but that Node can't resolve. Node 24 and later can keep a failed package lookup until the process exits, so a long-running host can miss a package installed after its first attempt; the loader now says to restart the process instead.
