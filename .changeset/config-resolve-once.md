---
"@askdb/config": minor
"@askdb/docs-site": patch
---

`@askdb/config` resolves each setting once (#711). One internal resolver checks, translates and defaults every `askdb.config` setting; `defineConfig`'s flat map and `getAskDbRuntimeConfig()` are both built from its result, and no runtime value is read back from a flat map.

- **A boolean setting must be `true` or `false`.** `logging.logStdout` and `modes.omitSensitiveFromPrompt` now fail to load on any other value, as `studio.execute.enabled`, `studio.execute.useIntrospectionConnection` and `httpApi.allowSchemaOverride` already did. Before, `omitSensitiveFromPrompt: "false"` turned the setting on, because a non-empty string is truthy.
- **A string setting that isn't a string fails to load** with an error naming the key, where it used to stop the load with a `TypeError` that named none. `null` and `false` still count as unset.
- **Load errors name config keys, never flat keys** such as `PORT`.
- **`AskDbRuntimeLoggingConfig.level` is `AskDbLogLevel | undefined` and `AskDbRuntimeModesConfig.askdbMode` is `AskDbModeV1 | undefined`,** not `string`.
- **`setAskDbRuntimeForTests(config)` takes an `AskDbConfig`** and installs it as `bootstrapAskDbEnv()` installs a loaded file. It used to take `{ structured, flat }`.
- **A store that another copy of `@askdb/config` installed resolves from its `structured` config,** as ADR 0005 asks; its `flat` map is never read. `getAskDbRuntimeConfig().flat` and `ai.aiEnv` are this copy's projection of that config.

`flattenAskDbConfig` writes the same keys as before. The configuration reference and the beta.48 upgrade notes cover the type checks, the narrowed types and the test helper.
