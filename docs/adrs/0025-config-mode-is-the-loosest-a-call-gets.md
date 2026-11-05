# ADR 0025 — Config `modes.askdbMode` is the loosest mode a call gets

## Status

Accepted (2026-11-05). The coordinator decided it on #279's plan, under the maintainer's 2026-09-27 decision in #279 that `@askdb/client` and the HTTP API honour the config `modes`. Recorded in [#279's comment](https://github.com/Ygilany/AskDB/issues/279#issuecomment-6665628696). The maintainer can reopen it. Implemented in `createAskDb().ask()` in `packages/client/src/client.ts`. Contract: [`modes-v1.md`](../contracts/modes-v1.md).

## Context

- `modes.askdbMode` is a deployment-wide setting in `askdb.config.*`. Before #279, `@askdb/client` ignored it. The CLI and the HTTP API each resolved `flag ?? config` or `request ?? config` themselves. So a per-call mode always won, and a library call that named no mode got core's default, `schema_only`.
- The HTTP API reads `mode` from the request body or the `x-askdb-mode` header. So a remote caller picks the trust boundary.
- `modes.omitSensitiveFromPrompt` is already a floor in the client (#187): a call can turn omission on, never off. `httpApi.allowSchemaOverride` keeps another per-request override behind the operator's opt-in.
- `bounded_results` is a reserved stub. Core only logs the mode (`askdb.pipeline.mode`), and both modes produce the same SQL. The bounded-results step ships after 1.0.

## Decision

- `@askdb/client` resolves the mode. It runs the stricter of the call's `mode` and `parseAskDbModeV1(config.modes.askdbMode)`, and an unset config counts as `schema_only`. A call can tighten the mode to `schema_only`. `bounded_results` runs only when the config allows it.
- A call that asks for a looser mode runs at the config mode, with no error. The `askdb.pipeline.mode` log line records the mode that ran. This matches the omit floor, which ignores a per-call `false`.
- The CLI and the HTTP API pass only the caller's mode and leave the config to the client. They still validate their own input first: a bad `--mode` exits 1, and a bad body `mode` or `x-askdb-mode` returns `400`. Their `askdb.run.start` lines no longer carry `mode`.
- Core's `ask()` reads no config, so the `mode` its caller passes is final.

## Options considered

- **The call's mode wins, and config is only the default.** Rejected. An HTTP request could loosen the operator's trust boundary, unlike the omit floor and `allowSchemaOverride`. Adding a floor after 1.0 would break callers.
- **A floor only when the config sets `askdbMode`.** Rejected. An unset config and `schema_only` would then mean different things, although the docs call `schema_only` the default. On a server whose operator never set `modes`, remote callers could opt into `bounded_results` once it does something.
- **Reject a looser request** (a new `ModeNotAllowedError`, HTTP `403`). Rejected. It turns today's `200` for `mode: "bounded_results"` into a `403` on every server without a config mode, for a mode that changes nothing yet. It also works differently from the omit floor.
- **Keep the resolution in each host.** Rejected. It meant three copies, and the library path had none, which is the bug in #279.

## Consequences

- `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `bounded_results` all run `schema_only` unless the config sets `bounded_results`. The SQL doesn't change today, because the mode is a stub.
- When the bounded-results step lands, the operator opts in through config. A caller can't opt in on its own.
- The client's rule compares against `schema_only` only. A third mode needs an explicit order from strictest to loosest.
- A log query that read `mode` from `askdb.run.start` must read `askdb.pipeline.mode` instead.
- An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are already validated when they load.
