---
"@askdb/client": minor
"@askdb/http-api": minor
"askdb": minor
"@askdb/docs-site": patch
---

`createAskDb().ask()` now applies config `modes.askdbMode` (#279, ADR 0025). Before, the client ignored it: a call that named no `mode` ran core's default, `schema_only`, whatever the config said. Only the CLI and the HTTP API read the config mode, each on its own.

The config mode is the loosest mode a call gets, the same rule as the `modes.omitSensitiveFromPrompt` floor. A call that names no mode runs the config mode. An unset config counts as `schema_only`. A call's `mode: "schema_only"` tightens a config of `bounded_results` for that call.

The CLI and the HTTP API now pass only the caller's mode to the client, so all three surfaces resolve it the same way. A bad `--mode` still exits 1, and a bad body `mode` or `x-askdb-mode` header still returns `400`.

**Upgrade notes (breaking):**

- A per-call mode can no longer loosen the config. `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `mode: "bounded_results"` now run `schema_only` unless `askdb.config.*` sets `modes: { askdbMode: "bounded_results" }`. There's no error: the `askdb.pipeline.mode` log line records the mode that ran. Today's SQL output doesn't change, because `bounded_results` still produces the same SQL as `schema_only`.
- The `askdb.run.start` log lines from the CLI and the HTTP API no longer carry a `mode` field. Read `mode` from `askdb.pipeline.mode`, which is in the same log stream.
- An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are validated when they load, as before.
