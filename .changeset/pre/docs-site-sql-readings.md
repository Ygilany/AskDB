---
"@askdb/docs-site": patch
---

The beta.52 upgrade notes cover #828 (a tenant policy with a table named `order` or `group` no longer refuses every sorted query) and #815 (every SQL check reads through the shared lexer). The SQL checks reference notes that the tenant check's scanner, quoted in the GHSA-rmjw-pffc-5hjr advisory, is gone since beta.52.
