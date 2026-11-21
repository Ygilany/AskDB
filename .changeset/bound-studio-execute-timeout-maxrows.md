---
"@askdb/config": patch
---

Bound `studio.execute.timeoutMs` (at most 2147481647) and `studio.execute.maxRows` (at most 2147483646): values that used to pass validation and break every query now fail at load (closes #333).
