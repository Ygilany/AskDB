# ADR 0039 — `askdb-http` refuses a schema it can't serve, and says why

## Status

Accepted (2026-11-06). The coordinator decided #716 and #720 on 2026-11-06 (the "Decision (2026-11-06)" section of each issue). Implemented in PR #806.

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
5. **A configured `dialect` is unchanged:** it wins over every schema's `provider`, a request `schemaJson`'s included, as on every surface (`@askdb/client`'s `resolveDialect`). The docs say so. Whether a request schema should resolve its own `provider` instead is #809.

## Consequences

- **`tenant_scope_not_configured` is a new public error code** in `AskHttpErrorResponse`. A client that matched `internal_error` for a tenant-policy schema matches the new code.
- **A server whose schema's engine AskDB doesn't ship stops returning SQL** until its operator sets `dialect` in `askdb.config.*`. The beta.50 upgrade entry says how.
- **#343's scope hook** keeps `tenant_scope_not_configured` for a server with no resolver.

## Related

- #716, #720, #343, #277, #809.
- [ADR 0012](0012-sql-checks-are-defense-in-depth.md) (fail closed where AskDB owns the mechanism).
- `plans/028-harden-client-error-types.md`, step 5 (the fallback this removes).
- `apps/http-api/src/server.ts` (`mapAskError`), `packages/client/src/client.ts` (`resolveDialect`).
