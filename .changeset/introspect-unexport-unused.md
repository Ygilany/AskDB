---
"@askdb/introspect": minor
---

**Breaking:** `connectorProviderMissingMessage` is no longer exported (#654): nothing outside `@askdb/introspect` used it, so it leaves before 1.0 (ADR 0031). A connector registry throws its message for a provider it has no adapter for, and `hasProvider(provider)` checks first. The upgrade guide's beta.52 section names it.
