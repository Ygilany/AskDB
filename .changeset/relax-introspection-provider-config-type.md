---
"@askdb/config": patch
---

Allow multiple introspection provider configs in `providerConfig` simultaneously.

Introduces `IntrospectionProviderConfigs` with all five provider keys (`postgres`, `prisma`, `mysql`, `sqlite`, `sqlserver`) as optional fields. Each `*IntrospectionConfig` branch now accepts the full set instead of only its own key, matching the same pattern already applied to the AI provider config.
