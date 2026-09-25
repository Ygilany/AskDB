# Plan 053: Make `"sql-params"` the default `tenantSqlMode`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> gh pr view 186 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> gh pr view 197 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> git grep -n 'bindTenantIntoUnboundSql' -- packages/core/src/ask.ts          # → matches (#197's executable-pairs contract landed)
> git grep -n 'tenantSqlMode ?? "sql-only"' -- packages/core/src/ask.ts       # → 1 match (the problem still exists)
> git grep -n 'mode: TenantSqlOutputMode = "sql-only"' -- packages/core/src/sql/tenant-placeholders.ts  # → 1 match
> ```

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED — changes what `ask()` returns for every tenant-scoped caller that never set `tenantSqlMode`.
- **Depends on**: #186, #197 (merged). Independent of plans 054/055/056, but 056 should land after this or set the mode explicitly (it does).
- **Category**: security
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: **Yes.** A caller that passes `tenantScope` without `tenantSqlMode` starts getting `result.sql` with driver markers (`$1` / `?` / `@p0`) plus `result.tenantParams`, instead of SQL with the tenant IDs inlined as literals. Pre-1.0, so this ships as a **minor** changeset. The failure mode for callers who miss it is loud, not silent: running marker SQL without params makes the driver error (Postgres "there is no parameter $1", better-sqlite3 "Too few parameter values", mysql2 a syntax error). It never returns other tenants' rows.

## Why this matters

Tenant IDs define a security boundary, and the library's default output inlines them into the SQL string. #197 made that inlining safe (dialect-aware escaping, substitution only in code regions), so this is not an injection bug. But binding values through the driver is the right default for values that define a boundary, and the literal form is only there for tools that take a single SQL string. Plan 046 Step 5 was this flip. #197 deferred it because it changes the result shape. #197 also defined the two executable pairs (`sql` + `tenantParams`, and `unboundSql` + `params`), so the flip now has a well-defined contract to land on.

## Current state

- `packages/core/src/ask.ts`, the tenant block inside `ask()`:

  ```ts
  if (tenantPolicy && options.tenantScope) {
    const tenantMode = options.tenantSqlMode ?? "sql-only";
  ```

  The JSDoc on `AskPipelineOptions.tenantSqlMode` says: `SQL output mode for tenant placeholders. Default "sql-only" inlines escaped literal values. "sql-params" replaces them with the dialect's driver markers ...`. The `AskPipelineResult` field docs (`sql`, `unboundSql`, `params`, `tenantParams`) describe both modes and are already correct for either default.
- `packages/core/src/sql/tenant-placeholders.ts`, the exported `resolveTenantSql`:

  ```ts
  export function resolveTenantSql(
    sql: string,
    policy: NormalizedTenantPolicy,
    scope: TenantScope,
    mode: TenantSqlOutputMode = "sql-only",
    paramStartIndex: number = 1,
    dialect?: TenantSqlDialect,
  ): TenantPlaceholderResult {
  ```
- Consumers of the mode outside core:
  - `@askdb/client` (`packages/client/src/client.ts`): `AskOverrides` is `Omit<AskPipelineOptions, "question" | "schema" | "model" | "dialect">`, and `ask()` spreads `...rest` into core's `ask()`. It inherits the core default automatically. **But** `packages/client/README.md` ("Parameterized output") shows `askdb.ask(..., { tenantScope })` followed by `await pool.query(result.sql);`. That snippet breaks after the flip.
  - Studio server (`apps/studio/src/server.ts`, `askSampleQuestion`) forwards `tenantSqlMode` only when set, then reports `sqlMode: options.tenantSqlMode ?? "sql-only"` in the response. That report would be wrong after the flip.
  - Studio UI (`apps/studio/src/web/contexts/playground-context.tsx`) sets the initial state to `askTenantSqlMode: "sql-only"`. The request always sends the UI's mode, so Studio itself is unaffected. Only the UI default differs from the library.
  - CLI (`apps/cli/src/cli.ts`) and HTTP API (`apps/http-api/src/server.ts`) never pass `tenantScope`, so they can't serve tenant-scoped schemas at all (core throws `MISSING_SCOPE`). The flip has no effect on them today. Plan 056 adds HTTP tenant support and sets the mode explicitly.
- Tests that depend on the default (verified at c7404d4). Expect roughly 4–6 to change:
  - `packages/core/src/sql/tenant-placeholders.test.ts`: `"defaults to sql-only mode with inlined literals"` and `"handles multi-value scope in sql-only mode"` (it doesn't pass a mode).
  - `packages/core/src/ask.test.ts`: the case asserting `"SELECT * FROM orders WHERE agency_id = '42' AND status = 'open'"` (no mode passed), and `"merges a custom dialect's reported failures into the result (warn)"`, which asserts `agency_id = '42'`.
  - `packages/core/src/sql/tenant-placeholders.test.ts` around the `resolveTenantSql(` call that passes no mode argument (the `IN (…)` rewrite case near the operator tests).
- Docs that state or imply the old default:
  - `apps/docs-site/src/content/docs/reference/core-api.mdx`: the options table row `tenantSqlMode` (default column `"sql-only"`). Also the "Tenant SQL output mode" list near the tenant types section: `"sql-params"` "converts tenant values to positional `$N` parameters". That wording has been stale since #197 and should read "dialect driver markers".
  - `apps/docs-site/src/content/docs/reference/client-api.mdx`: `tenantSqlMode` row (no default stated).
  - `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`: `## SQL output modes` table, plus `## Testing in Studio` ("Switch between `sql-only` and `sql-params`…").
  - `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`: result table row `tenantParams` ("When `tenantSqlMode: "sql-params"` is set").
  - `docs/contracts/tenant-policy.md`: `### Output modes` table (`**SQL-only** (default)`).
  - `docs/specs/multi-tenancy.md` and `docs/specs/core-pipeline.md`: mode lists.
  - `packages/client/README.md` (see above) and `apps/studio/README.md` line "SQL output modes (`sql-only` vs `sql-params`)" (neutral, but check it).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Core placeholder tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-placeholders.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| Studio tests | `pnpm --filter @askdb/studio test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Docs | `pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |
| SQLite exec suite | `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/sqlite test` | all pass (needs `better-sqlite3` built, see CONTRIBUTING.md "Integration Tests") |

## Scope

**In scope**:
- `packages/core/src/ask.ts`: the default, and the `tenantSqlMode` JSDoc only
- `packages/core/src/sql/tenant-placeholders.ts`: the `resolveTenantSql` default, plus a new exported constant
- `packages/core/src/index.ts`: export the constant
- `packages/core/src/sql/tenant-placeholders.test.ts`, `packages/core/src/ask.test.ts`
- `apps/studio/src/server.ts`: the `sqlMode` report only
- `apps/studio/src/web/contexts/playground-context.tsx`: initial `askTenantSqlMode`
- The docs files listed in Current state, plus `packages/client/README.md`
- `.changeset/tenant-sql-params-default.md` (create)

**Out of scope**:
- The substitution logic and the executable-pairs contract (`bindTenantIntoUnboundSql`). Don't touch them. This plan only changes which mode is used when none is given.
- Removing `"sql-only"`. It stays supported for tools that need a single string.
- HTTP API and CLI tenant support. Plan 056 covers the HTTP API. The CLI has no tenant surface.

## Git workflow

- Branch: `plan/053-default-tenant-sql-params`. One PR, don't merge.
- Conventional commits, e.g. `feat(core)!: default tenantSqlMode to sql-params`.

## Steps

### Step 1: Add one source of truth for the default

In `packages/core/src/sql/tenant-placeholders.ts`, next to `TenantSqlOutputMode`, add:

```ts
/** `tenantSqlMode` used when a caller does not set one: bind tenant IDs through driver markers. */
export const DEFAULT_TENANT_SQL_MODE: TenantSqlOutputMode = "sql-params";
```

Use it as the default for `resolveTenantSql`'s `mode` parameter. Update that function's JSDoc to say the default binds, and that `"sql-only"` inlines escaped literals for tools that take a single SQL string.

Export `DEFAULT_TENANT_SQL_MODE` from `packages/core/src/index.ts` in the existing `./sql/tenant-placeholders.js` export block.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Flip `ask()`

In `packages/core/src/ask.ts`, replace `options.tenantSqlMode ?? "sql-only"` with `options.tenantSqlMode ?? DEFAULT_TENANT_SQL_MODE` (import it). Rewrite the `tenantSqlMode` JSDoc. Default `"sql-params"`: run `sql` with `tenantParams`, or `unboundSql` with `params`, and never concatenate them. `"sql-only"` inlines escaped literals and exists for callers that can't bind parameters. Keep the existing marker-style sentence.

**Verify**: `git grep -n '"sql-only"' -- packages/core/src/ask.ts` → only the `if (tenantMode === "sql-only")` branch and the explicit `"sql-only"` argument inside it remain. There is no `?? "sql-only"`.

### Step 3: Update the tests that encoded the old default

Run `pnpm --filter @askdb/core test` and fix each failure one of two ways:
- The test is **about the default**: rename it (e.g. `"defaults to sql-params: sql runs with tenantParams"`), then assert the marker SQL and `tenantParams`. Keep exactly one such test. It is the primary owner of the default contract.
- The test is about something else and only incidentally used the default (merging custom-dialect warnings, parameterize extras, multi-ID `IN` rewrite): pass `tenantSqlMode: "sql-only"` explicitly so it keeps asserting what it was written for.

Never weaken an assertion (e.g. `toBe` → `toContain`) to make a test pass.

**Verify**: `pnpm --filter @askdb/core test` → all pass. `git diff --stat -- packages/core/src/**/*.test.ts` shows ≤ ~6 tests changed. If more than 10 break, STOP.

### Step 4: Studio

- `apps/studio/src/server.ts` `askSampleQuestion`: report the mode that was actually used, `sqlMode: options.tenantSqlMode ?? DEFAULT_TENANT_SQL_MODE` (import from `@askdb/core`).
- `apps/studio/src/web/contexts/playground-context.tsx`: `askTenantSqlMode: "sql-params"` as the initial state, so the Playground and its "Get the code" snippet (`apps/studio/src/web/views/playground/GetTheCodePanel.tsx`, which already emits `tenantSqlMode` explicitly and destructures `tenantParams` in `sql-params`) start from the library default. Execute already sends `result.tenant.params` with `sql`, so no execute change is needed.

**Verify**: `pnpm --filter @askdb/studio lint && pnpm --filter @askdb/studio test` → exit 0.

### Step 5: Docs

Update every file in the Current state docs list: the default is `sql-params`, what callers run (`sql` + `tenantParams` or `unboundSql` + `params`), and the one-line opt-out (`tenantSqlMode: "sql-only"`). Fix `packages/client/README.md` so the `tenantScope` snippet runs `result.sql` with `result.tenantParams`, or `unboundSql` with `params`. Fix the stale "positional `$N`" wording in `core-api.mdx`. Don't invent APIs. Every name you write must exist in `packages/core/src/index.ts`.

**Verify**: `git grep -n -i -e 'sql-only' -- apps/docs-site/src docs/contracts docs/specs packages/client/README.md` → read every hit. None may describe `sql-only` as the default (e.g. `**SQL-only** (default)` or a default column value of `"sql-only"`). Then `pnpm docs:build` → exit 0.

### Step 6: Changeset and release checks

Create `.changeset/tenant-sql-params-default.md`: `"@askdb/core": minor`, `"@askdb/studio": patch`. Lead with the behavior change and the remedy (`tenantSqlMode: "sql-only"` restores the old output). State that executing the new `sql` without `tenantParams` fails loudly at the driver. Mention the new `DEFAULT_TENANT_SQL_MODE` export.

**Verify**: `pnpm changeset status` → no package gets a **major** bump. `@askdb/core` is `linked` with `askdb` and `@askdb/http-api` in `.changeset/config.json`, so they'll share a version, which is expected. If any package shows major, STOP. Then `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → all exit 0.

## Test plan

Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`) to every new or changed test.

- **Owner boundary**: `ask()` in `@askdb/core`. The single renamed default test in `packages/core/src/sql/tenant-placeholders.test.ts` (`describe("ask() — tenant SQL output modes")`) owns "no `tenantSqlMode` means marker SQL + `tenantParams`". Regression it catches: someone reverting the default, or `ask()` and `resolveTenantSql` disagreeing about it.
- Don't add a Studio test for the default. The server just forwards the constant. The existing Studio tests only need to keep passing.
- The SQLite exec suite (`packages/sqlite/src/exec/tenant-binding.exec.test.ts`) passes explicit modes and should be unaffected. Run it under `ASKDB_REQUIRE_INTEGRATION=1` to prove it.

## Docs impact

Pages (AGENTS.md: the docs site must stay accurate): `reference/core-api.mdx`, `reference/client-api.mdx`, `guides/multi-tenancy.mdx`, `guides/embed-in-node.mdx`; internal `docs/contracts/tenant-policy.md`, `docs/specs/multi-tenancy.md`, `docs/specs/core-pipeline.md`; `packages/client/README.md`.

## Done criteria

- [ ] `git grep -n 'tenantSqlMode ?? "sql-only"' -- packages apps` → no matches
- [ ] `git grep -n 'DEFAULT_TENANT_SQL_MODE' -- packages/core/src/index.ts apps/studio/src/server.ts` → matches in both
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm docs:build` exit 0
- [ ] `pnpm smoke:install && pnpm preflight` exit 0; `pnpm changeset status` shows no major bumps
- [ ] No test changed by weakening an assertion; exactly one test owns the default
- [ ] `.changeset/tenant-sql-params-default.md` exists and leads with the behavior change

## STOP conditions

- Readiness check fails.
- More than ~10 existing tests break in Step 3. The flip then has wider consequences than planned, so report the list.
- A test failure shows `sql` + `tenantParams` or `unboundSql` + `params` is **not** an executable pair in `sql-params` mode for some dialect. That is a #197 contract bug, not something to paper over here.
- `pnpm changeset status` reports a major bump for any package.
- You find another in-repo consumer that runs `result.sql` without params after passing `tenantScope` (grep `\.sql)` near `tenantScope`). List it and fix it only if it's in the in-scope list.

## Maintenance notes

- `DEFAULT_TENANT_SQL_MODE` is the only place the default lives. Hosts (Studio today, the HTTP API in plan 056) should import it rather than hard-coding a string.
- Reviewer focus: every changed test either owns the default or pins `"sql-only"` explicitly, and the docs no longer call `sql-only` the default anywhere.
- Deferred: removing `"sql-only"` entirely. Some tools only accept a single SQL string, so keep it.
