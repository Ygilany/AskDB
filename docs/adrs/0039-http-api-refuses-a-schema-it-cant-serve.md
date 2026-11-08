# ADR 0039 — `askdb-http` refuses a schema it can't serve, and says why

## Status

Accepted (2026-11-06; amended 2026-11-06, #809, #840, #845). The coordinator decided #716 and #720 on 2026-11-06 (the "Decision (2026-11-06)" section of each issue). Implemented in PR #806.


> **Amendment (2026-11, #886):** Studio now picks the dialect by the same rule: `@askdb/client` exports it as `resolveDialect()` (the maintainer's Q49, option A), and Studio calls it, so its Playground refuses a schema whose `provider` has no AskDB dialect, as the CLI and `askdb-http` do. The *`@askdb/client` doesn't change* consequence still holds for the rule's behavior; only its export is new.

## Context

Two schemas reached `POST /ask` and got an answer that hid the cause.

- **A schema whose `provider` has no AskDB dialect** (#720), such as `snowflake`. Plan 028 (step 5) built the server's client with `unknownDialect: "fallback-postgres"` to keep the server's behavior from before that plan, and left dropping it to a later decision. So the server answered `200` with PostgreSQL SQL, checked under PostgreSQL's lexer, while `askdb ask` refused the same schema. Checking SQL for one engine under another engine's rules can pass SQL the real engine reads differently, the bug class of #703 and #704 (ADR 0012).
- **A schema with a tenant policy** (#716). The server can't pass a `tenantScope` (#277, #343), so `ask()` refuses every request with `TenantScopeError` (`MISSING_SCOPE`) before the model call, as ADR 0012 Decision 3 requires. `mapAskError` had no branch for it, so the caller got the generic `500 internal_error`, which reads as a crash.

## Options considered

For #720:

- **A. Refuse, with the status chosen by where the schema came from, reusing `generation_not_configured` (chosen).** No new code. The row for `generation_not_configured` widens to two causes.
- **B. Refuse, with a new `500 dialect_not_configured`.** A clearer name, but one more public code before the 1.0 freeze, and a client can't act differently on either `500`.
- **C. Refuse with `400 bad_request` always,** the mapping the server already had. It blames the caller for the server's configuration, and returns the server's config hint to them.
- **D. Keep the fallback and document it.** Rejected: it keeps checking SQL under a guessed engine's rules.

For #716:

- **A. `500 tenant_scope_not_configured` (chosen),** #343's own code, so #343's scope hook keeps it.
- **B. `501`.** That status means an HTTP method the server doesn't support, which this isn't.
- **C. A `4xx` code.** It blames the caller, who can't fix it.

## Decision

1. **No PostgreSQL fallback.** The server builds its client without `unknownDialect`, so `DialectNotSupportedError` reaches `mapAskError` on every request whose schema names an engine AskDB doesn't ship. The client option stays for hosts that choose it.
2. **The status follows the schema's source.** The server's configured schema answers `500 generation_not_configured`, with a generic message, because only the operator can fix it. A request's `schemaJson` answers `400 bad_request`, with a message that names the provider and the supported ids and not the server's config.
3. **The log names the cause.** The `askdb.run.error` line's `errName` is `DialectNotSupportedError` or `ModelNotConfiguredError`, so an operator tells the two `generation_not_configured` causes apart without a new code.
4. **`tenant_scope_not_configured` for a missing scope only.** `TenantScopeError` with reason `MISSING_SCOPE` answers `500 tenant_scope_not_configured`, with a message that names the tenant policy and leaks no schema detail. The server never passes a scope, so other reasons can't occur; they stay the generic `500 internal_error`.
5. **A configured `dialect` is unchanged:** it wins over every schema's `provider`, a request `schemaJson`'s included, as on every surface (`@askdb/client`'s `resolveDialect`). The docs say so. Whether a request schema should resolve its own `provider` instead is #809. *Superseded by the 2026-11-06 amendment below.*

## Consequences

- **`tenant_scope_not_configured` is a new public error code** in `AskHttpErrorResponse`. A client that matched `internal_error` for a tenant-policy schema matches the new code.
- **A server whose schema's engine AskDB doesn't ship stops returning SQL** until its operator sets `dialect` in `askdb.config.*`. The beta.50 upgrade entry says how.
- **#343's scope hook** keeps `tenant_scope_not_configured` for a server with no resolver.

## Amendments

**2026-11-06 — A request schema answers for its own engine (#809):** Decision 5 let a configured `dialect` win over a request `schemaJson`'s `provider`, so a server configured for `postgres` generated and checked PostgreSQL for a request schema that recorded `mysql`, #720's bug class reached through the config. The maintainer chose option A on #809 (Q26).

- **The server resolves a request schema's dialect itself.** It loads the `schemaJson` (`loadSchemaFromJson`; one that doesn't load is still `400 schema_parse_error`) and passes the artifact's `provider` to `askdb.ask()` as the per-call `dialect`. SQL is generated and checked (read-only, tenant and sensitive) under that dialect. The config's `dialect` applies to the server's own schema only.
- **A request schema that records no `provider`, or one AskDB has no dialect for, answers `400 bad_request`** (`DialectNotSupportedError`, Decision 2's branch). The message names the provider, or says there is none, and the supported ids, and never points the caller at the server's config.
- **`@askdb/client` doesn't change.** `resolveDialect` keeps "a configured `dialect` wins" for the CLI, Studio and hosts; the HTTP server, which knows which schema came from the request, overrides it per call.
- **Options not taken:** refusing a request schema whose `provider` disagrees with the config (it would bar a caller from any other engine on that server), and keeping Decision 5 with the note logged (the caller still got another engine's SQL).

**2026-11-06 — A server schema that doesn't load (#840):** a wrong `host.schemaPath` answered any caller `400 schema_parse_error`, with the server's absolute path in the message. Decision 2 now covers loading too: the server's own schema answers `500 generation_not_configured` with a generic message that names no path, and the `askdb.run.error` log line keeps the full `SchemaLoadError`. A request `schemaJson` that doesn't load keeps `400 schema_parse_error`. A third cause joins Decision 3's `errName` list: `SchemaLoadError`. Options not taken:
- **Keep `400 schema_parse_error` and drop the path from the message.** It still blames the caller for the operator's configuration, Option C's reason for #720.
- **`500 internal_error`.** It reads as a crash and tells the client nothing about the cause, the reason #716 named its own code.
- **A new public code, such as `schema_not_loaded`.** One more public code before the 1.0 freeze, Option B's reason for #720; a client can't act differently on it, and the log's `errName` already names the cause.

**2026-11-06 — No schema configured server-side (#845):** with no `--schema-path`, `host.schemaJson` or `host.schemaPath`, a request without its own `schemaJson` answered `400 bad_request`, the server's misconfiguration reported as the caller's error, the class #840 fixed for a schema that doesn't load. The maintainer chose A on #845: `SchemaNotConfiguredError` answers `500 generation_not_configured` with a generic message, and the `askdb.run.error` log line's `errName` names it: `SchemaNotConfiguredError`, a fourth cause beside Decision 3's two and #840's `SchemaLoadError`. A request that sends its own `schemaJson` doesn't need the server's schema and is unaffected. Keeping `400 bad_request`, on the ground that a caller can send `schemaJson` when overrides are on, was the option not taken: overrides are off by default, and the operator still has to fix the server.

## Related

- #716, #720, #343, #277, #809.
- [ADR 0012](0012-sql-checks-are-defense-in-depth.md) (fail closed where AskDB owns the mechanism).
- `plans/028-harden-client-error-types.md` at `90babc30`, step 5 (the fallback this removes). `plans/` was removed after that commit (#368).
- `apps/http-api/src/server.ts` (`mapAskError`), `packages/client/src/client.ts` (`resolveDialect`).
