---
"@askdb/client": patch
---

`askdb.bind()` takes `dialect`, which it passes to `bindPreparedQuery()`. Pass the `DialectSpec` you gave `askdb.ask()` when its `preparedQuery.dialectRules` is `"host"`, or, for a template stored without `dialectRules`, the spec `ask()` ran with, or its built-in id if it ran with the built-in rules (#660).
