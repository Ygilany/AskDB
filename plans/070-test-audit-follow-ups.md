# Plan 070: Test-audit follow-ups — config flatten table, the core barrel test, repo-level requireability test, targeted Studio tenancy tests

> **Executor instructions**: Four independent parts (a)–(d). Do (a)–(c) in one PR; (d) is a separate PR and has its own go/no-go in its first step. **Invoke the test-audit skill first** (`.agents/skills/test-audit/SKILL.md`) — every edit here must pass its authoring gate and junk-pattern check, and follow its Validation section. Run every verification command and confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)**:
>
> ```bash
> for n in 180 203 204; do gh pr view $n --repo Ygilany/AskDB --json number,state -q '"\(.number) \(.state)"'; done   # → all MERGED
> test -f .agents/skills/test-audit/SKILL.md && echo ok                                      # → ok (skill landed with #180)
> test -f packages/client/src/client.hooks.test.ts && echo ok                                 # → ok (#203 renamed client.smoke.test.ts)
> git grep -n "flattens MySQL introspection branch\|flattens SQLite introspection branch\|flattens SQL Server introspection branch\|flattens postgres introspection databaseUrl" -- packages/config/src/config.test.ts   # → 4 matches: (a) still to do
> git grep -n "imports PreparedQuery / BoundQuery / bindPreparedQuery from @askdb/core" -- packages/client/src/client.hooks.test.ts   # → 1 match: (b) still to do
> test -f packages/core/src/package-requireability.test.ts && echo ok                          # → ok: (c) still to do
> find apps/studio/src/web -name "*.test.*" | wc -l                                             # → 0: (d) still to consider
> # No open PR should still be editing these files (the reason (a)/(b) were deferred):
> gh pr list --repo Ygilany/AskDB --state open --json number,files -q '.[] | select(any(.files[]; .path=="packages/config/src/config.test.ts" or .path=="packages/client/src/client.test.ts")) | .number'   # → empty
> ```
>
> Any part whose check shows it already done: skip it and say so in the PR.

## Status

- **Priority**: P3
- **Effort**: S for (a)–(c); M for (d)
- **Risk**: LOW — test-only and tooling changes; (c) must keep the requireability contract running in CI.
- **Depends on**: PRs #203 (client test rename, follow-ups listed), #204 (core test-audit), #180 (turbo `test` runs in CI; test-audit skill) merged. (d) soft-depends on plan 051 (Studio tenant-policy authoring), see (d) Step 1.
- **Category**: tests
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No.

## Why this matters

The 2026-09 test-audit PRs (#202–#205) deliberately deferred edits to files that open review PRs were still touching. Once those merge, four items remain: a hand-unrolled per-engine test block in config, a core-contract test living in the client package, a whole-repo packaging test living inside `@askdb/core`, and the Studio web UI (~7.7k lines of `.ts`/`.tsx` under `apps/studio/src/web`) with zero tests despite having shipped a tenancy-editor crash (plan 044).

## Current state

### (a) `packages/config/src/config.test.ts`, `describe("flattenAskDbConfig")`

Four near-identical tests, each building `minimalConfig({ introspection: { provider, providerConfig: { <engine>: {...} }, outputDir: "./askdb/" } })` and asserting one flat key:
- `it("flattens postgres introspection databaseUrl to ASKDB_INTROSPECT_POSTGRES_URL")` → `postgres://introspect/db`
- `it("flattens MySQL introspection branch to ASKDB_INTROSPECT_MYSQL_URL")` → `mysql://app:pw@localhost/shop`, **plus** `expect(flat.DATABASE_URL).toBeUndefined()`
- `it("flattens SQLite introspection branch to ASKDB_INTROSPECT_SQLITE_FILE")` → `./data/app.db`
- `it("flattens SQL Server introspection branch to ASKDB_INTROSPECT_SQLSERVER_URL")` → `Server=localhost;Database=app;`

The postgres case duplicates the first test in the same describe, `it("maps openai + mock rag + memory store")`, which already asserts `expect(flat.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://localhost/db")` from `minimalConfig()`'s default postgres introspection (`providerConfig: { postgres: { databaseUrl: "postgres://localhost/db" } }`). #203's PR body: "fold the four per-engine flatten tests into one `it.each` and drop the duplicate postgres `databaseUrl` flatten test".

### (b) `packages/client/src/client.hooks.test.ts`

`describe("createAskDb hooks and core re-exports")` has two tests:
- `it("onResolve hook fires with dialect and modelSource info")` — the only assertion of `modelSource === "mock"`; kept in a separate file because open PRs were editing `client.test.ts`.
- `it("imports PreparedQuery / BoundQuery / bindPreparedQuery from @askdb/core and rebinds")` — imports `bindPreparedQuery` and types `BoundQuery`, `PreparedQuery`, `QueryParameterBinding` from the `@askdb/core` barrel, rebinds a `:state_name` prepared query, asserts `sql`, `unboundSql` (`$1`), `params`, `bindings[0].markers`. It never touches the client.

Facts that decide where (b) goes:
- `packages/core/src/sql/bind.test.ts` owns binder behavior (it imports `bindPreparedQuery` from `./bind.js`, not the barrel). The only core test importing the barrel is `schema/v2/schema-evolution.test.ts`.
- Type imports in vitest files are **not typechecked** (`pnpm lint` uses each package's `tsconfig.build.json`, which excludes `*.test.ts` — noted in #204), so the `type PreparedQuery…` imports in (b) prove nothing.
- The installable smoke consumer `examples/installable-smoke/consumer/src/smoke.ts` imports from the **packed tarball** of `@askdb/core` (`ask`, `loadNormalizedSchemaFromJson`, `loadSchemaFromJson`, `type AskDbSchemaFile`, `type AskDialect`) and `run.sh` runs `npx tsc --noEmit` on it ("Type-level check (enforced by `tsc --noEmit`)" comments exist there). It does not import `bindPreparedQuery`.
- `bindPreparedQuery` is public, documented in `apps/docs-site/src/content/docs/guides/embed-in-node.mdx` (`import { bindPreparedQuery } from "@askdb/core";`).
- Precedent: #202 deleted `packages/introspect/src/index.test.ts` ("exports renderToSchemaV2()") as a re-export existence probe once a real consumer imported through the package.

### (c) `packages/core/src/package-requireability.test.ts`

`describe("published package requireability")` scans **every** `packages/*/package.json` that isn't `private` (`publishedPackages()` reads `join(repositoryRoot, "packages")`) and asserts: `it("keeps default last in every export map")` and `it("does not introduce top-level await in published sources")` (walks each export's static relative-import graph from `src/`). `repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")`. It lives in core only by accident; it does not scan `apps/*` (whose `askdb`, `@askdb/http-api`, `@askdb/studio` are also published).

CI plumbing: root `pnpm test` = `turbo run test`; turbo runs the `test` script of every workspace package (`pnpm-workspace.yaml`: `packages/*`, `apps/*`, `examples/*`); `turbo.json` `tasks.test` has `dependsOn: ["build", "^build"]` and `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/vitest.config.ts", "$TURBO_ROOT$/scripts/test-utils/**", "$TURBO_ROOT$/fixtures/**"]`. Package test scripts are `vitest run --config ../../vitest.config.ts`; root `vitest.config.ts` includes `**/*.test.ts` relative to the cwd. Root `devDependencies` include `vitest ^4.1.10`. `scripts/` holds `release-preflight.sh` and `test-utils/` (not a workspace package).

### (d) Studio web UI

`find apps/studio/src/web -name "*.test.*"` → none. Test environment is `node` (root `vitest.config.ts`), no jsdom/testing-library in `apps/studio/package.json` devDependencies. Plan 044 (DONE) made `pnpm lint` typecheck the web UI (`tsc -p tsconfig.web.json`) and fixed the `TenancyPage.tsx` crash where `removeHierarchyEdge(i)` referenced an unbound `i` — that whole crash class (unbound identifiers, wrong arity, wrong prop types) is now caught at compile time.

What typecheck cannot catch lives in `apps/studio/src/web/views/tenancy/TenancyPage.tsx` (923 lines), all module-private:
- `function createFormReducer(state: CreateFormState, action: CreateFormAction): CreateFormState` and `initialCreateFormState` (create flow: `set_mode`, `select_root_table` resets `rootTenantIdColumn`, `toggle_global_table`, `ai_draft_complete` → `mode: "review"`, …).
- Inside `TenancyReviewDraft`: `updateEnforcement`, `updateRootLabel`, `removeRoot` (refuses to remove the last root), `removeHierarchyEdge` / `removeScopedTable` / `removePolymorphicTable` (drop to `undefined` when the list empties), `toggleGlobalTable`.
- `function frontmatterFromTenantPolicy(policy: NormalizedTenantPolicy): TenantPolicyFrontmatter` (omits empty lists) and `clone`.

The server validates what these produce: `POST /api/tenant-policy` → `parseTenantPolicyBody` → `tenantPolicyFrontmatterSchema.safeParse(body.frontmatter)` → 400 "Invalid tenant policy: …". `tenantPolicyFrontmatterSchema`, `parseTenantPolicyMarkdown`, `normalizeTenantPolicy` are exported from `@askdb/core`. Fixture with a policy: `fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md`. Plan 051 (TODO) will add add/edit authoring to this editor.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm install && pnpm build` | exit 0 |
| Config tests | `pnpm --filter @askdb/config exec vitest run --config ../../vitest.config.ts src/config.test.ts` | all pass |
| Client tests | `pnpm --filter @askdb/client exec vitest run --config ../../vitest.config.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts` | all pass |
| Studio tests | `pnpm --filter @askdb/studio exec vitest run --config ../../vitest.config.ts` | all pass |
| Smoke (packed tarballs + tsc) | `pnpm smoke:install` | exit 0 |
| Gates | `pnpm lint && pnpm test && pnpm preflight` | exit 0 |

## Scope

**In scope**: `packages/config/src/config.test.ts`; `packages/client/src/client.hooks.test.ts` (delete), `packages/client/src/client.test.ts`; `examples/installable-smoke/consumer/src/smoke.ts`; `packages/core/src/package-requireability.test.ts` (move); `tooling/repo-tests/**` (create), `pnpm-workspace.yaml`, `pnpm-lock.yaml`; for (d) only: `apps/studio/src/web/views/tenancy/TenancyPage.tsx`, `apps/studio/src/web/views/tenancy/policy-edits.ts` (create), `apps/studio/src/web/views/tenancy/policy-edits.test.ts` (create).

**Out of scope**: any production behavior change; adding jsdom/testing-library or component-render tests; a coverage campaign over the web UI; the `onResolve` semantics; `bind.test.ts`.

## Git workflow

- Branches: `plan/070-test-audit-follow-ups` for (a)–(c); `plan/070d-studio-tenancy-edit-tests` for (d).
- Commit style: `test(config): table-drive per-engine flatten cases`, `test: move requireability check to tooling/repo-tests`.
- Test-only changes need no release changeset, but the Changesets check fires on `packages/*/src/**`; add an empty changeset (`---\n---`) as #204/#205 did if `pnpm changeset status --since=origin/main` fails.

## Steps

### (a) Step 1: one `it.each` for introspection flattening

Replace the four tests with:
```ts
it.each([
  ["postgres", { postgres: { databaseUrl: "postgres://introspect/db" } }, "ASKDB_INTROSPECT_POSTGRES_URL", "postgres://introspect/db"],
  ["mysql", { mysql: { databaseUrl: "mysql://app:pw@localhost/shop" } }, "ASKDB_INTROSPECT_MYSQL_URL", "mysql://app:pw@localhost/shop"],
  ["sqlite", { sqlite: { file: "./data/app.db" } }, "ASKDB_INTROSPECT_SQLITE_FILE", "./data/app.db"],
  ["sqlserver", { sqlserver: { databaseUrl: "Server=localhost;Database=app;" } }, "ASKDB_INTROSPECT_SQLSERVER_URL", "Server=localhost;Database=app;"],
] as const)("flattens %s introspection to its canonical key and never DATABASE_URL", (provider, providerConfig, key, value) => {
  const flat = flattenAskDbConfig(minimalConfig({ introspection: { provider, providerConfig, outputDir: "./askdb/" } as AskDbConfig["introspection"] }));
  expect(flat[key]).toBe(value);
  expect(flat.DATABASE_URL).toBeUndefined();
});
```
and delete `expect(flat.ASKDB_INTROSPECT_POSTGRES_URL).toBe("postgres://localhost/db");` from `it("maps openai + mock rag + memory store")` (the table's postgres row now owns it). Keep `it("omits ASKDB_INTROSPECT_POSTGRES_URL when postgres databaseUrl is not set")` — different contract.

Gate: the `DATABASE_URL` assertion now covers all four engines (previously MySQL only) — a strengthening, not a new test.

**Verify**: config tests pass; `git grep -c "introspection to its canonical key" -- packages/config/src/config.test.ts` → 1; the four old titles → 0 matches.

### (b) Step 2: move the barrel check to the packed-package consumer; fold `onResolve`

1. In `examples/installable-smoke/consumer/src/smoke.ts`, add `bindPreparedQuery`, `type BoundQuery`, `type PreparedQuery`, `type QueryParameterBinding` to the existing `@askdb/core` import, and add one block after the existing `ask()` checks that rebinds the same `:state_name` prepared query as the client test and throws `new Error("smoke: …")` if `sql`, `unboundSql`, `params` or `bindings[0].markers` differ — matching the file's existing `if (…) throw new Error("smoke: …")` style. This makes the export **and its types** a checked contract of the published tarball (`tsc --noEmit` in `run.sh`).
2. Move `it("onResolve hook fires with dialect and modelSource info")` into `packages/client/src/client.test.ts`'s `describe("createAskDb")`, reusing that file's existing fixtures/registry helpers instead of the hooks file's `fakeRegistry`/`mockConfig` if equivalents exist (the hooks file header says it uses the mock-SQL path — `client.test.ts` "2. mock SQL path" has the setup). Delete `packages/client/src/client.hooks.test.ts`.

Gate: (1) Q1 contract = "`bindPreparedQuery` and its types are exported by the published `@askdb/core`" (documented in `guides/embed-in-node.mdx`); Q2 fails if the export is dropped from `packages/core/src/index.ts` or types regress; Q3 nothing else checks it through the package; Q4 no seam. (2) is a move.

**Verify**: `pnpm smoke:install` → exit 0 and its output shows the consumer ran; `test ! -e packages/client/src/client.hooks.test.ts`; client tests pass with the same count minus one (the barrel test) — record before/after counts.

### (c) Step 3: relocate the requireability test to a repo-level tooling package

1. Add `"tooling/*"` to `packages:` in `pnpm-workspace.yaml`.
2. Create `tooling/repo-tests/package.json`:
   ```json
   { "name": "askdb-repo-tests", "private": true, "type": "module",
     "scripts": { "test": "vitest run --config ../../vitest.config.ts" } }
   ```
   (Unscoped name on purpose: plan 067 puts `@askdb/*` in a changesets `fixed` group.) vitest resolves from the root `devDependencies`.
3. Create `tooling/repo-tests/turbo.json`: `{ "extends": ["//"], "tasks": { "test": { "cache": false } } }` — the test reads every package's sources, which turbo's default per-package inputs would not hash, so a cached pass could hide a regression.
4. `git mv packages/core/src/package-requireability.test.ts tooling/repo-tests/src/package-requireability.test.ts`. `repositoryRoot` stays `resolve(dirname(fileURLToPath(import.meta.url)), "../../..")` (same depth — verify it resolves to the repo root). Extend `publishedPackages()` to scan `apps/*` as well as `packages/*` (still filtering `private`) — `askdb`, `@askdb/http-api` and `@askdb/studio` are published too. If an app fails the new scan, STOP and report (that's a real finding, not something to paper over).
5. `pnpm install` (lockfile gains the workspace entry).

**Verify**: `pnpm --filter askdb-repo-tests test` → 2 tests pass; `pnpm test` output lists `askdb-repo-tests:test`; `test ! -e packages/core/src/package-requireability.test.ts`; `pnpm preflight` → exit 0.

### (d) Step 1: go/no-go (separate PR)

If plan 051 is IN PROGRESS or DONE, **do not** do (d) here — the editor is being rewritten; instead add a note to plan 051's PR/ticket that its new edit logic should follow Step 2's shape. Otherwise continue.

Framing (record it in the PR description): this is **not** a coverage campaign. The crash class plan 044 fixed is owned by `pnpm lint`'s web typecheck; no test for it passes gate Q3. The remaining, uncaught risk is semantic: an edit produces frontmatter the server rejects (400) or silently drops data. Tests target exactly that, at the boundary the server enforces.

### (d) Step 2: extract the pure edit logic, then test it against the server's schema

1. Create `apps/studio/src/web/views/tenancy/policy-edits.ts` and **move** (no behavior change) `createFormReducer`, `initialCreateFormState`, their types, `frontmatterFromTenantPolicy`, `clone`, and the six `TenancyReviewDraft` edit helpers rewritten as pure functions `(frontmatter, …args) => TenantPolicyFrontmatter` (e.g. `removeHierarchyEdge(frontmatter, index)`); `TenancyPage.tsx` imports and calls them (`onFrontmatterChange(removeHierarchyEdge(frontmatter, index))`). Import types from `@askdb/core` only — **no `@/…` path alias** in this module (the root vitest config doesn't resolve it). This is a production refactor with a real caller, not a test-only seam (gate Q4).
2. Create `policy-edits.test.ts` (node environment) with at most these cases, each justified in a one-line comment naming the regression:
   - Round-trip: load `fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md` via `parseTenantPolicyMarkdown` + `normalizeTenantPolicy` (from `@askdb/core`), `frontmatterFromTenantPolicy(...)` → `tenantPolicyFrontmatterSchema.safeParse(...)` succeeds. Regression: the editor's starting frontmatter would be rejected on Save.
   - `it.each` over the edit helpers applied to that frontmatter (remove each list's first entry, toggle a global table, change enforcement/label): result passes `tenantPolicyFrontmatterSchema` and emptied lists become `undefined`, not `[]`. Regression: an edit produces a 400 on Save.
   - `removeRoot` on a single-root policy returns it unchanged. Regression: user can delete the last root and save an invalid policy.
   - `createFormReducer`: `select_root_table` clears `rootTenantIdColumn`; `ai_draft_complete` moves to `review`. Regression: stale column carried to a different root table.

**Verify**: Studio tests pass incl. the new file; `pnpm lint` (web typecheck + eslint) → exit 0; `pnpm --filter @askdb/studio build` → exit 0; manual smoke optional.

## Test plan

Summarized per part above. Owners after this plan: introspection flattening → one `it.each` in `config.test.ts`; `@askdb/core` public binder export → installable smoke consumer; `onResolve` → `client.test.ts`; export-map/TLA packaging contract → `tooling/repo-tests` (now covering apps too); tenancy edit semantics → `policy-edits.test.ts` against `tenantPolicyFrontmatterSchema`.

## Docs impact

None (tests/tooling). If `CONTRIBUTING.md` lists where repo-level checks live, add one line for `tooling/repo-tests`.

## Changeset guidance

No release changeset (test/tooling only). Add an empty changeset only if the Changesets status check demands one; `tooling/*` is private and outside the check's `paths:` filter. (d) changes `apps/studio/src/**` → the check requires a changeset: `@askdb/studio` patch "internal: extract tenancy editor edit logic".

## Done criteria

- [ ] (a) four per-engine tests → one `it.each`; postgres duplicate assertion removed; config tests pass
- [ ] (b) `client.hooks.test.ts` deleted; `onResolve` test lives in `client.test.ts`; smoke consumer imports and checks `bindPreparedQuery`; `pnpm smoke:install` exits 0
- [ ] (c) requireability test runs from `tooling/repo-tests` via `pnpm test`, scans `packages/*` and `apps/*`, `cache: false`
- [ ] (d) either skipped with a recorded reason (plan 051 active) or `policy-edits.ts` + ≤4 test cases landed
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm preflight` exit 0

## STOP conditions

- An open PR still edits `config.test.ts` or `client.test.ts` (readiness) — do (c)/(d) only.
- Extending the requireability scan to `apps/*` fails for a published app — report the finding; don't weaken the test.
- turbo does not pick up `tooling/repo-tests` in `pnpm test` after adding it to the workspace.
- (d) extraction requires changing what the editor does (not just where the code lives).
- A new test fails on first run in a way that suggests a product bug — per test-audit, reproduce and report rather than adjusting the assertion.

## Maintenance notes

- New published packages are automatically covered by (c) as long as they live under `packages/*` or `apps/*`.
- When plan 060 removes the `@askdb/ai-*` shims, the smoke consumer's `@askdb/ai-openai` import (existing) goes with it — unrelated to (b)'s addition.
- Plan 051 should put new add/edit operations into `policy-edits.ts` and extend its `it.each` rather than adding render tests.
