---
"@askdb/docs-site": patch
---

The docs say the tenant check refuses a call whose reads it can't see, such as `query_to_xml`, `table_to_xml`, `crosstab`, `dblink`, `OPENQUERY` or `set_config`, under every dialect (#702): the core API reference (its `UNCHECKABLE_FUNCTION` rule row and the custom-dialect paragraph), the multi-tenancy guide's "What the tenant check requires", safety boundaries, troubleshooting, and a beta.47 upgrade entry.
