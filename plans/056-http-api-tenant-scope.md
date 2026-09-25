# Plan 056: Serve tenant-scoped schemas over the HTTP API, with the scope set server-side

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> gh pr view 186 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> gh pr view 187 --repo Ygilany/AskDB --json state -q .state   # → MERGED (typed error mapping, allowSchemaOverride)
> gh pr view 197 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> git grep -n 'function mapAskError' -- apps/http-api/src/server.ts            # → 1 match
> git grep -n 'tenantScope' -- apps/http-api/src                              # → no matches (no server support yet)
> git grep -n 'unmapped errors return 500 internal_error' -- apps/http-api/src/server.integration.test.ts  # → 1 match (TenantScopeError → generic 500 today)
> ```

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: HIGH. This is a security boundary. Getting the trust source wrong lets any caller read any tenant's data.
- **Depends on**: #186, #187, #197 (merged). Soft: plan 053 (this plan sets `tenantSqlMode` explicitly, so it works either way).
- **Category**: direction
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No. New server option, new response field, and new error codes (additive to `AskHttpErrorResponse["error"]["code"]`). One behavior change: a tenant-policy schema without a configured resolver returns a specific `500 tenant_scope_not_configured` instead of the generic `500 internal_error`. Minor changeset for `@askdb/http-api`.

## Why this matters

`@askdb/http-api` can't serve a schema that has `tenant-policy.md`. `POST /ask` never passes a `tenantScope`, so core's `validateTenantScope` throws `TenantScopeError("MISSING_SCOPE")`. `mapAskError` doesn't know that error, so the caller gets `500 internal_error`. #187's own follow-up notes say this, and there's a test that pins it ("unmapped errors return 500 internal_error with a generic message"). Multi-tenant is exactly where a hosted SQL-generation service is most useful, so this blocks a whole deployment shape.

## Design decision: where the tenant scope comes from

The scope decides which tenants' rows the generated SQL may read. It has to come from the operator's authenticated context and never from the end user.

| Option | Verdict |
|---|---|
| **A. `tenantScope` in the request body** | **Rejected.** The body is caller-controlled. Any caller who can reach the server (directly, or through a gateway that forwards bodies) can claim `{ kind: "global" }` or another tenant's IDs. |
| **B. Trusted header set by the gateway** (e.g. `x-askdb-tenant-scope: <json>`) | **Rejected for now.** It's only safe if every gateway in front strips any client-supplied copy of the header. A missed strip is a full cross-tenant bypass with no error. A signed header (HMAC or JWS) fixes that but needs key management, expiry and replay handling. It's a reasonable follow-up for the standalone binary, not a first version. |
| **C. Server-side hook** (`resolveTenantScope(req)` passed to `createAskDbHttpServer`) | **Chosen.** The operator's own code authenticates the request (e.g. verifies a session cookie or JWT from `req.headers`) and returns the scope in the same process. The trust decision lives with the auth decision. There's no header to spoof and no key to distribute. It matches how #187 treats config as a floor that a request can't loosen. |

Consequences:
- The standalone `askdb-http` binary has no hook, so it still can't serve tenant-policy schemas. It now returns `500 tenant_scope_not_configured` with a message pointing to `createAskDbHttpServer({ resolveTenantScope })`. Signed-header support for the binary is a deferred follow-up.
- The hook gets the `IncomingMessage` (headers, socket) and the correlation id, **not** the parsed body. This keeps operators from deriving scope from user-controlled input by accident.
- A request body that contains `tenantScope` is **rejected** with `400 bad_request`, the same way the retired `execute` field is rejected. This makes a client that thinks it can set its own scope fail visibly, instead of having the field silently ignored.
- When `resolveTenantScope` is configured, per-request `schemaJson` overrides are refused with `403 schema_override_disabled`, even if `httpApi.allowSchemaOverride` is `true`. An override schema without `tenant-policy.md` would make `ask()` treat the request as single-tenant and return unscoped SQL. That silently removes tenant enforcement.

## Current state

- `apps/http-api/src/server.ts`:
  - `AskDbHttpServerOptions = { port?, host?, schemaPath?, maxBodyBytes? }`.
  - `handleRequest` validates `question`, rejects `"execute" in body || getHeader(req, "x-askdb-execute") !== undefined` with 400, resolves `mode`, and gates `schemaJson` on `rt.httpApi.allowSchemaOverride` (403 `schema_override_disabled`). It then calls `askdb.ask(body.question, { schema, logger, mode, explain, omitSensitiveIdentifiersFromNlToSqlPrompt, abortSignal })` on a lazily built `createAskDb({ config: rt, registry: ai, schema, unknownDialect: "fallback-postgres" })`.
  - The success payload is `{ ok, correlationId, sql, explain, usage, sensitiveGuardrail? }`. It has no `tenantParams`.
  - `mapAskError(e, ctx)` classifies with `isErrorOf(e, Ctor)` (`instanceof` or a `name` fallback). It maps `SqlGenerationError` → 502, `SqlValidationError` → 400, `SensitiveReferenceError` and `TenantGuardrailError` → 422 `guardrail_violation`, schema errors → 400, `ModelNotConfiguredError` → 500 `generation_not_configured`, `DialectNotSupportedError` → 400, and everything else → 500 `internal_error`. It doesn't import `TenantScopeError`.
- `apps/http-api/src/types.ts`: `AskHttpRequest`, `AskHttpSuccessResponse`, and `AskHttpErrorResponse` with its `code` union.
- `packages/core/src/errors.ts`: `TenantScopeError` has `reason: TenantScopeRejectionReason`. The reasons are `MISSING_SCOPE | UNKNOWN_TENANT_ROOT | GLOBAL_WITHOUT_REASON | INVALID_SCOPE_SHAPE | UNSUPPORTED_ACCESS_KIND | UNRESOLVED_TENANT_PLACEHOLDER | UNSUPPORTED_TENANT_PREDICATE`, plus `SUBTREE_NOT_RESOLVABLE` if plan 054 has landed. `TenantScope` is exported from `@askdb/core`.
- Tests: `apps/http-api/src/server.integration.test.ts` runs in the normal unit run (plain `describe("http-api")`, with no DB). It has helpers `installTestRuntime({ mockSql, logLevel, httpApi, … })`, `startApp(options)` and `postAsk(url, body, headers)`, and `tenantSchemaPath` → `fixtures/schemas/agency-multi-tenant.schema/` (strict policy; roots `table:public.agencies` "Agency", sub-agencies, clients).
- Docs: `apps/docs-site/src/content/docs/reference/http-api.mdx` (options table, request fields, success fields, error codes table, "What this server doesn't do: No auth"), `guides/deploy-as-http-service.mdx` ("Run it behind a gateway"), `apps/http-api/README.md`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| http-api tests | `pnpm --filter @askdb/http-api test` | all pass |
| Typecheck | `pnpm --filter @askdb/http-api lint` | exit 0 |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**: `apps/http-api/src/server.ts`, `types.ts`, `index.ts`, `server.integration.test.ts`, `apps/http-api/README.md`, `apps/docs-site/src/content/docs/reference/http-api.mdx`, `apps/docs-site/src/content/docs/guides/deploy-as-http-service.mdx`, `.changeset/http-api-tenant-scope.md`.

**Out of scope**: signed or trusted-header scope for the binary (follow-up); returning `unboundSql`/`params`/`preparedQuery` over HTTP; any change to `@askdb/core` or `@askdb/client`; subtree resolver plumbing (`resolveTenantSubtree`). If plan 054 has landed, a hook that returns a `subtree` scope gets `SUBTREE_NOT_RESOLVABLE`, mapped below. Add the resolver option in a follow-up.

## Git workflow

Branch `plan/056-http-api-tenant-scope`; one PR, don't merge. Style: `feat(http-api): resolve tenant scope server-side via resolveTenantScope`.

## Steps

### Step 1: Types

In `types.ts`:
- Add to the `code` union: `"tenant_scope_not_configured"` (500), `"tenant_scope_denied"` (403), `"tenant_scope_invalid"` (500) and `"tenant_binding_error"` (422).
- Add to `AskHttpSuccessResponse`: `tenantParams?: unknown[]`, documented as present when the SQL has tenant markers, and meaning "run `sql` with `tenantParams`".

In `server.ts`, add to `AskDbHttpServerOptions`:

```ts
/**
 * Resolve the tenant scope for a request from your own auth context (headers,
 * session, mTLS identity). Called once per `POST /ask`, before the model call.
 * Return `null`/`undefined` to refuse the request (403 `tenant_scope_denied`).
 * The request body is deliberately not passed: never derive scope from
 * caller-controlled input. Required to serve a schema with `tenant-policy.md`.
 */
resolveTenantScope?: (req: IncomingMessage, ctx: { correlationId: string }) => TenantScope | null | undefined | Promise<TenantScope | null | undefined>;
```

Import `TenantScope` and `TenantScopeError` from `@askdb/core`. Re-export nothing new from `index.ts` beyond the updated types.

**Verify**: `pnpm --filter @askdb/http-api lint` → exit 0.

### Step 2: Request handling

In `handleRequest`, after the `execute` rejection:
1. If `"tenantScope" in body` → `400 bad_request`: "`tenantScope` cannot be sent by the caller. The server resolves it from the request's authentication."
2. If `options.resolveTenantScope` is set and `body.schemaJson` is a non-empty string → `403 schema_override_disabled` (message: "…disabled while tenant scoping is configured"). Check this **before** the `allowSchemaOverride` branch.
3. If `options.resolveTenantScope` is set, call it inside `try`. A thrown error → log it and return `500 internal_error` (generic message). A `null` or `undefined` result → `403 tenant_scope_denied` ("No tenant scope for this request."). Otherwise pass `tenantScope` and `tenantSqlMode: "sql-params"` to `askdb.ask(...)`. Explicit `"sql-params"` means clients always get marker SQL plus `tenantParams` over HTTP, whatever the library default.
4. Add `...(out.tenantParams ? { tenantParams: out.tenantParams } : {})` to the payload.
5. Log the scope kind (not the IDs) on `RunStart`: `tenantScopeKind: scope.access.kind`.

**Verify**: `pnpm --filter @askdb/http-api lint` → exit 0.

### Step 3: Error mapping

In `mapAskError`, before the fallthrough, add `isErrorOf(e, TenantScopeError)`:
- `MISSING_SCOPE` → 500 `tenant_scope_not_configured`: "This schema has a tenant policy. Serve it with createAskDbHttpServer({ resolveTenantScope }); the askdb-http binary cannot serve tenant-scoped schemas." It's a server-side configuration error, the same class as `generation_not_configured`.
- `INVALID_SCOPE_SHAPE`, `UNKNOWN_TENANT_ROOT`, `GLOBAL_WITHOUT_REASON`, `UNSUPPORTED_ACCESS_KIND`, `SUBTREE_NOT_RESOLVABLE` → 500 `tenant_scope_invalid` with a generic message ("The server's tenant scope was rejected. See server logs for this correlationId."). The hook produced the scope, so it's an operator bug, and the details (root ids) are logged, not returned.
- `UNRESOLVED_TENANT_PLACEHOLDER`, `UNSUPPORTED_TENANT_PREDICATE` → 422 `tenant_binding_error` with `rule: e.reason` and the core message. The generated SQL couldn't be bound to the scope, which is the same class as `guardrail_violation`.
- Any other reason (a future one) → the existing generic 500.

Use a `switch` on `e.reason` with no default that returns a success-shaped code. Unknown reasons must fall through to 500.

**Verify**: `pnpm --filter @askdb/http-api lint` → exit 0.

### Step 4: Tests

Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`). The owner boundary is the HTTP contract in `server.integration.test.ts`: request in, status/code/body out. Use `tenantSchemaPath` and `installTestRuntime({ mockSql: "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids", logLevel: "silent" })`. Cases, each naming the regression it catches:

1. A hook returning `{ access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42", "99"] } }` → 200. The body's `sql` has markers (`$1, $2` / `IN (...)`) and `tenantParams` is `["42","99"]`. Catches: scope not passed, or the pair not returned.
2. The hook reads a header (`x-test-tenant`), and two requests with different header values get different `tenantParams`. Catches: a scope cached across requests on the lazily built facade.
3. Body `{ question, tenantScope: {...global...} }` with a hook configured → 400 `bad_request`, and the hook's scope is **not** overridden. Catches: a caller-supplied scope being honored.
4. The hook returns `null` → 403 `tenant_scope_denied`. The mock SQL generator is never used (assert via a counter in the hook or the log).
5. The hook is configured, `allowSchemaOverride: true`, and `schemaJson` is sent → 403 `schema_override_disabled`. Catches: bypass through a policy-free schema.
6. No hook on the tenant schema → 500 `tenant_scope_not_configured`. **Replace** the existing "unmapped errors return 500 internal_error" test's trigger. To keep generic-500 coverage, make a hook that throws produce `500 internal_error` with the generic message and no hook error text in the body.
7. A hook returning an unknown root → 500 `tenant_scope_invalid`, and the body doesn't contain the root id.
8. `mockSql` using `:tenant_client_ids` with an agency-only scope → 422 `tenant_binding_error`, `rule: "UNRESOLVED_TENANT_PLACEHOLDER"`.

**Verify**: `pnpm --filter @askdb/http-api test` → all pass. Each new case fails if you stub `resolveTenantScope` out of `handleRequest`.

### Step 5: Docs, changeset, release checks

- `reference/http-api.mdx`: add the `resolveTenantScope` option row with a short example (verify a JWT from `req.headers.authorization` with your own library and map claims to `TenantScope`, without naming a specific JWT package's API), the `tenantParams` success field, the four error codes, and a "Multi-tenant schemas" subsection stating the trust model (scope from the server hook only; body `tenantScope` rejected; `schemaJson` disabled while tenant scoping is on; the binary can't serve tenant schemas yet). Change "No auth" to say the server has no authentication of its own, and that `resolveTenantScope` is where your auth decides the tenant.
- `guides/deploy-as-http-service.mdx`: a short "Multi-tenant schemas" section pointing to the reference. Execution must run `sql` with `tenantParams`, and the database should still enforce tenancy (link `/concepts/safety-boundaries/#run-generated-sql-safely`).
- `apps/http-api/README.md`: one paragraph with the same facts.
- `.changeset/http-api-tenant-scope.md`: `"@askdb/http-api": minor`. `@askdb/http-api` is `linked` with `@askdb/core` and `askdb` in `.changeset/config.json`, so expect a shared version line.

**Verify**: `pnpm changeset status` → no major bumps. `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

Covered in Step 4. The HTTP contract is the only owner. Core already tests scope validation and binding, so don't re-test binding details (marker styles, operators) here. Assert only that the HTTP layer passes the scope through, returns the pair, and maps the errors.

## Docs impact

`reference/http-api.mdx`, `guides/deploy-as-http-service.mdx`, `apps/http-api/README.md`. `guides/multi-tenancy.mdx` gets one sentence linking to the HTTP reference ("Serving over HTTP").

## Done criteria

- [ ] `git grep -n 'resolveTenantScope' -- apps/http-api/src/server.ts apps/docs-site/src/content/docs/reference/http-api.mdx` → matches in both
- [ ] `git grep -n 'TenantScopeError' -- apps/http-api/src/server.ts` → match
- [ ] The Step 4 cases exist and pass; the old "TenantScopeError → internal_error" expectation is gone
- [ ] Full gate and release checks exit 0; no major bumps

## STOP conditions

- Readiness check fails.
- `createAskDb().ask()` (`packages/client/src/client.ts`) drops `tenantScope` or `tenantSqlMode` instead of forwarding them via `...rest`. The fix would then be in `@askdb/client`, which is out of scope.
- A maintainer requirement surfaces that the standalone binary must serve tenant schemas in this PR. That needs the signed-header design, so stop and report instead of improvising a trusted-header mode.
- You find that the facade caches anything per tenant scope across requests.

## Maintenance notes

- The hook is the security boundary for HTTP multi-tenancy. Review every change to `handleRequest` for a new path to `askdb.ask()` that skips it.
- If a future option lets requests pick among several scopes the operator allows (e.g. `x-askdb-tenant`), the hook must validate the choice. Never pass it through.
- Follow-ups: signed-header scope for `askdb-http`; `resolveTenantSubtree` passthrough (plan 054); optionally returning `unboundSql`/`params`.
