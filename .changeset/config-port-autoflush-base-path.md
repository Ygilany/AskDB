---
"@askdb/config": minor
"@askdb/docs-site": patch
---

`@askdb/config` fixes three mismatches between the config type and the code that reads it, before the package goes to 1.0 (#676).

- **`httpApi.listen.port`:** a value that reads as `NaN`, such as `Number(env("PORT"))` with `PORT` unset, counts as unset, so the server uses port 3000. Before, `NaN` reached `listen()` and the server failed to start with `ERR_SOCKET_BAD_PORT`. Any other value that isn't an integer from 0 to 65535, or a string holding one, now fails when the config loads, with `askdb.config: invalid httpApi.listen.port …`. A port given as a string becomes a number in `getAskDbRuntimeConfig().httpApi.listen.port`.
- **`rag.storeConfig.file.autoFlush`** is deprecated. Nothing ever read it, because the file store writes its files after every change. A config that sets it now gets a `DeprecationWarning` (code `ASKDB_CONFIG_DEPRECATED`), and it's listed in `getAskDbRuntimeConfig().deprecations`.
- **`DEFAULT_RAG_FILE_BASE_PATH` is removed.** Nothing read it, and its value, `./askdb/rag`, was never the file store's default: with `rag.storeConfig.file.basePath` unset, the CLI and Studio use `<schema dir>/schema`. `flattenAskDbConfig` no longer writes `ASKDB_RAG_FILE_BASE_PATH` when `basePath` is unset.

The JSDoc in `AskDbConfig` now matches the code: `dialect` is inferred from the schema artifact's recorded provider, nothing reads `ASKDB_INTROSPECT_<ENGINE>_URL` from the environment, and `httpApi.listen.port` shows `Number(env("PORT") ?? 3000)`.

The configuration reference and the beta.47 upgrade notes cover the port check, the removed export and the deprecated key.
