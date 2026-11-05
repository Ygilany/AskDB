---
"@askdb/core": patch
---

`isBuiltInDialectId()` accepts only the built-in dialect ids. It used to accept `Object.prototype` names such as `"constructor"` or `"toString"` too. So `ask()` now throws `UnknownDialectError` for such a string id, and with a tenant scope, a `DialectSpec` under such an `id` must set `tenantSqlMode`, as any other unknown dialect must.
