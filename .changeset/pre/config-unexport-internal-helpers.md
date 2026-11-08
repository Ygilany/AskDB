---
"@askdb/config": minor
---

**Breaking:** `@askdb/config` no longer exports `flattenAskDbConfig`, `isAskDbEnvProjection` or `ASKDB_ENV_PROJECTION` (#830). Nothing outside the package imported them, and its API page listed them as internal. `defineConfig(config).entries` is the same map `flattenAskDbConfig(config)` returned. Loading a config file and `bootstrapAskDbEnv()` behave as before. `mergeAskDbFlatIntoEnvMap` and `getAskDbRuntimeConfig().flat` stay exported while Studio still reads the flat map (#752).
