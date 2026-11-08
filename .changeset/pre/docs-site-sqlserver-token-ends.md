---
"@askdb/docs-site": patch
---

The SQL checks reference and the beta.52 upgrade notes say where SQL Server ends a name or number (after `0x` or `1E`, and at U+00A0, U+200B and U+0085), and that the tenant check reads those ends the same way (#623).
