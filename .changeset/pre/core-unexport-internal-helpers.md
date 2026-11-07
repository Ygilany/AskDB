---
"@askdb/core": minor
---

**Breaking:** `@askdb/core` no longer exports 21 internal helpers (#852). Nothing outside the package imported them, and its API page listed them as internal exports with no stability promise. After 1.0, removing them would need a major release. They still run inside `@askdb/core`, so `ask()` and every documented function behave as before.

- **The zod schemas** `v2TableSchema`, `v2ColumnSchema`, `v2TableFrontmatterSchema`, `v2ColumnFrontmatterSchema`, `v2ConceptsFrontmatterSchema`, `v2ConceptSchema`, `tenantRootSchema`, `hierarchyEdgeSchema`, `scopedTableSchema`, `polymorphicTableSchema`, `enforcementModeSchema` and `tenantAccessSchema`. Their types, such as `V2Table` and `TenantRoot`, stay exported.
- **The heading lists** `RECOGNIZED_H2_SECTIONS` and `TENANT_POLICY_H2_SECTIONS`. The types `RecognizedH2Section` and `TenantPolicyH2Section` stay exported.
- **The pipeline helpers** `assertNlToSqlInputs`, `buildNlToSqlSystemPrompt`, `buildSelectGuardrailExplanation`, `escapeSqlLiteral` and `extractTenantPlaceholders`.
- **The v1 schema steps** `parseAskDbSchemaJson` and `normalizeAskDbSchema`. `loadNormalizedSchemaFromJson`, which runs both, stays exported.

The seven internal exports that Studio, the CLI or `@askdb/enrich` import stay: `tenantPolicyFrontmatterSchema`, `tenantScopeSchema`, `v2SchemaJsonSchema`, `normalizeTenantPolicy`, `formatAskDbModesV1`, `formatSupportedAskDbLogLevels` and `isSupportedAskDbLogLevel`. The upgrade guide gives a replacement for each removed name.
