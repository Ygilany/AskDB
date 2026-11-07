---
"@askdb/docs-site": patch
---

The docs say the tenant-policy loader refuses a column on another table than its entry's under `strict`, with the new `TenantPolicyWarning` `misplaced_column_id` (#836): the tenant-policy reference's "When the policy and the schema disagree" table, the core API reference (`loadSchema()`, `SchemaParseError` and `normalizeTenantPolicy()`, which takes a column ID → table ID map), the multi-tenancy guide, troubleshooting, the schema-artifact reference and the beta.50 upgrade guide.
