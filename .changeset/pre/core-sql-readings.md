---
"@askdb/core": patch
---

Internal: the SQL checks take their readings from one module, and the tenant check reads code, strings and comments through the shared lexer instead of a scanner of its own. No check's verdict changes.
