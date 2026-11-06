---
"@askdb/http-api": minor
"askdb": minor
---

The HTTP API server and the CLI use `logging.level` as `@askdb/config` resolves it, without checking it again (#711). Behavior is unchanged: the config already refuses a level that isn't one of `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` when it loads.
