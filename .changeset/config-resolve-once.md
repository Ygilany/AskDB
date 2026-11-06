---
"@askdb/config": minor
"@askdb/docs-site": patch
---

`@askdb/config` resolves each setting once (#711). One internal resolver checks, translates and defaults every `askdb.config` setting and writes its flat-map key in the same pass, so `defineConfig`'s flat map and `getAskDbRuntimeConfig()` agree. `getAskDbRuntimeConfig()` never reads a value back from a flat map.

- **A boolean setting must be `true` or `false`.** `logging.logStdout` and `modes.omitSensitiveFromPrompt` now fail to load on any other value, as `studio.execute.enabled`, `studio.execute.useIntrospectionConnection` and `httpApi.allowSchemaOverride` already did. Before, `omitSensitiveFromPrompt: "false"` turned the setting on, because a non-empty string is truthy.
- **A string setting must be a string, or `null` for unset.** Any other value fails to load with an error naming the key, `host.schemaJson`, `host.schemaPath` and `studio.listen.host` included. Before, `false` or `0` was ignored for a few keys, such as `logging.logFile`, and stopped the load with a `TypeError` that named no key for the rest.
- **Load errors name config keys, never flat keys** such as `PORT`: a pgvector store without a URL names `rag.storeConfig.pgvector.databaseUrl`, not `ASKDB_PGVECTOR_URL`. An object or array value is described by its type, never printed.
- **`AskDbRuntimeLoggingConfig.level` is `AskDbLogLevel | undefined` and `AskDbRuntimeModesConfig.askdbMode` is `AskDbModeV1 | undefined`,** not `string`.
- **`setAskDbRuntimeForTests(config)` takes an `AskDbConfig`** and installs it as `bootstrapAskDbEnv()` installs a loaded file. It used to take `{ structured, flat }`.
- **A store that another copy of `@askdb/config` installed resolves from its `structured` config,** as ADR 0005 asks; its `flat` map is never read. `getAskDbRuntimeConfig().flat` and `ai.aiEnv` are this copy's projection of that config.

`flattenAskDbConfig` writes the same keys as before. The configuration reference and the 1.0.0-rc.1 upgrade notes cover the type checks, the narrowed types and the test helper.
