---
"@askdb/docs-site": patch
---

The docs say the tenant check refuses a statement that doesn't start with `SELECT` or `WITH`, under every dialect, a custom `AskDialect` included (#698): the core API reference (its `NOT_SELECT_OR_WITH` rule row and the custom-dialect paragraph), the multi-tenancy guide's "What the tenant check requires", safety boundaries, troubleshooting, and a beta.46 upgrade entry.
