---
"@askdb/docs-site": patch
---

The beta.50 upgrade guide says the tenant-policy loader refuses a column on another table than its entry's, under `strict`, with the new `TenantPolicyWarning` `misplaced_column_id`, and that `normalizeTenantPolicy()` takes a column ID → table ID map (#836).
