---
"@askdb/client": patch
---

`askdb.bind()` takes `dialect`, which it passes to `bindPreparedQuery()`. Pass the `DialectSpec` you gave `askdb.ask()` when its `preparedQuery.dialectRules` is `"host"`, or a built-in id for a template stored without `dialectRules` (#660).
