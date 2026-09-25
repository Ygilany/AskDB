# Plan 071: Verify the integration composition fixes landed on `main`, then retire draft PR #201

> **Executor instructions**: This is a verification checklist. For each of the seven fixes, run the check on an up-to-date `main`; if it passes, tick it; if it fails, apply the listed fix on the branch below. Run every verification command and confirm the expected result. Closing PR #201 and deleting its branch are **[HUMAN]** steps — prepare them, don't do them. If anything in "STOP conditions" occurs, stop and report. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)**:
>
> ```bash
> for n in $(seq 180 205); do [ "$n" = 201 ] && continue; printf '%s ' "$n"; gh pr view $n --repo Ygilany/AskDB --json state -q .state; done
> # → every line MERGED (a CLOSED-without-merge PR means its content may be missing — STOP and ask which fixes still apply)
> gh pr view 201 --repo Ygilany/AskDB --json state,isDraft -q '"\(.state) draft=\(.isDraft)"'   # → OPEN draft=true
> git fetch origin && git switch main && git pull --ff-only
> ```

## Status

- **Priority**: P1 (run immediately after the last review PR merges)
- **Effort**: S
- **Risk**: LOW (checks are read-only; fixes are small and each has a named test)
- **Depends on**: all of PRs #180–#205 merged (except #201, which must never merge).
- **Category**: tests / release hygiene
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No.

## Why this matters

The review PRs #180–#205 were written in parallel against `main`. Draft PR #201 (`review/integration-check`, "DO NOT MERGE") merged all of them onto one branch and found seven places where two PRs are individually correct but wrong together — e.g. a test written for one chunk-id format landing next to a PR that changed the format, or new live-database suites that bypass the fail-on-skip gate another PR introduced. Those fixes were pushed back to the PR branches or listed in #201 for the merger to apply. If any was lost in the real merges, CI either goes red (best case) or silently skips database suites (worst case). This checklist proves each landed, then retires #201.

Read the source list yourself: `gh pr view 201 --repo Ygilany/AskDB --json body -q .body` ("composition fixes 1–7").

## Current state (what "landed" looks like — verified on `review/integration-check @ c7404d4`)

`integrationSuite` (from #180) is defined in `scripts/test-utils/integration.mjs` (types in `integration.d.mts`): `integrationSuite(prereqs = {})` takes `{ env?: (string | string[])[]; unavailable?: string | false | null }` and returns `describe`, `describe.skip`, or — when `ASKDB_REQUIRE_INTEGRATION=1` — a suite that fails with "has its integration prerequisites". Packages import it as `../../../../scripts/test-utils/integration.mjs`. A `cond ? describe : describe.skip` gate bypasses the fail-on-skip rule, which is why fixes (a) and (g) exist.

Package names for `--filter`: `@askdb/sqlite`, `@askdb/postgres`, `@askdb/core`, `@askdb/studio`, `@askdb/rag`, `@askdb/prisma`, `askdb` (apps/cli).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm install && pnpm build` | exit 0 |
| One package's tests | `pnpm --filter <pkg> exec vitest run --config ../../vitest.config.ts <path>` | pass |
| Fail-on-skip check | prefix with `ASKDB_REQUIRE_INTEGRATION=1` and no DB env | suites **fail** with "has its integration prerequisites" (not skip) |
| Full | `pnpm lint && pnpm test && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope** (only if a check fails): the files named in the failing item, plus `.changeset/*.md` when that item says so.
**Out of scope**: anything else; re-litigating the review PRs; merging #201.

## Git workflow

- Branch (only if any fix is needed): `plan/071-post-merge-composition-fixes`; one commit per fix, message style `fix(<pkg>): <what> (composition fix N from #201)`; one PR; do not merge.
- If all seven pass: no branch; post the checklist results as a comment on #201 (**[HUMAN]** posts it, or the agent drafts it for them).

## Steps — the checklist

### Check (a): SQLite `describe.live` suite is gated by `integrationSuite()` (#201 fix 6; #180 × #189)

- Check: `git grep -n "integrationSuite(" -- packages/sqlite/src/connector/describe.live.test.ts`
- Expected: `…describe.live.test.ts:NN:const suite = integrationSuite({ unavailable });`
- Missing looks like: no output, and `git grep -n "describe.skip" -- packages/sqlite` shows `const suite = driver ? describe : describe.skip;`
- Fix if missing (applied on the integration branch as `01cf788`): make `loadDriver()` return `{ driver?: Bs3Namespace; unavailable: string | null }` (the load error message as `unavailable`), import `integrationSuite` from `../../../../scripts/test-utils/integration.mjs`, drop `describe` from the vitest import, `const suite = integrationSuite({ unavailable });`.
- Test: `pnpm --filter @askdb/sqlite exec vitest run --config ../../vitest.config.ts src/connector/describe.live.test.ts` → pass.

### Check (b): in-test build removed from `spawn-first-run.test.ts` (#201 fix 7; #180 × #182)

- Check: `git grep -n '"-C", cliDir, "build"' -- 'apps/**/*.test.ts'` and `git grep -n '"build", "^build"' -- turbo.json`
- Expected: first → no output; second → one line (turbo `test` depends on `build`, from #180).
- Missing looks like: `apps/cli/src/spawn-first-run.test.ts:NN: const build = spawnSync("pnpm", ["-C", cliDir, "build"], …)` — it races the turbo build.
- Fix: delete that `spawnSync(... "build" ...)` line and its `expect(build.status).toBe(0);` from the `beforeAll` of `describe("cli spawn: first run outside a project (no askdb.config)")`, leaving `emptyDir = mkdtempSync(join(tmpdir(), "askdb-cli-empty-"));` and a comment "dist/cli.js is produced by turbo: `test` depends on this package's own `build`."
- Test: `pnpm --filter askdb build && pnpm --filter askdb exec vitest run --config ../../vitest.config.ts src/spawn-first-run.test.ts` → pass.

### Check (c): the call's dialect reaches `ask()`'s guardrails and tenant placeholder scanning (#201 fix 4; #190 × #186/#197/#192/#194)

- Check:
  ```bash
  git grep -nE "applySensitiveGuardrail\(result, options, dialectSpec|dialect: dialectSpec|scanPlaceholders\(ctx\.namedSql, ctx\.dialectSpec\)|scanTenantPlaceholders\(sql, lexerDialect|executeDialectFor\(exec\.provider" -- packages/core/src apps/studio/src
  git ls-files .changeset/integration-dialect-aware-guardrails.md
  ```
- Expected: six lines — `packages/core/src/ask.ts` ×3 (`applySensitiveGuardrail(result, options, dialectSpec, logger);`, `dialect: dialectSpec,` inside `applySensitiveGuardrail`, `scanPlaceholders(ctx.namedSql, ctx.dialectSpec)` in `bindTenantIntoUnboundSql`), `packages/core/src/sql/tenant-placeholders.ts` ×2 (`scanTenantPlaceholders(sql, lexerDialect(dialect))`), `apps/studio/src/server.ts` ×1 (`executeDialectFor(exec.provider, rt.nlToSql.dialect),`) — and the changeset file listed. (If plan 066 already split `server.ts`, the Studio line lives in `apps/studio/src/server/execute-service.ts`; widen the path.)
- Missing looks like: `applySensitiveGuardrail(result, options, logger)`, `validateSensitiveReferences(result.sql, options.schema, { mode })`, `scanPlaceholders(ctx.namedSql)`, `scanTenantPlaceholders(sql)`, `sensitiveExecuteWarnings(sql, schemaDir)`.
- Fix: re-apply integration commit `9374227` ("fix(core,studio): lex sensitive checks and tenant placeholders with the call's dialect"; `git show 9374227` on the `review/integration-check` branch while it still exists): thread `dialectSpec` into `applySensitiveGuardrail` → `validateSensitiveReferences(..., { mode, dialect: dialectSpec })`; add optional `dialect` to `scanTenantPlaceholders` (`packages/core/src/sql/bind.ts`), `extractTenantPlaceholders`, `resolvePlaceholders`, `substituteTenantPlaceholders` via a `lexerDialect()` helper and pass it from `replacePlaceholdersWithLiterals`, `replacePlaceholdersWithParams`, `resolveTenantSql`; pass `ctx.dialectSpec` in `bindTenantIntoUnboundSql`; give Studio's sensitive-execute check `executeDialectFor(exec.provider, rt.nlToSql.dialect)`. **Do not** reintroduce a `nextIndex` return from `replacePlaceholdersWithParams()` (#197's audit removed it; `9374227` predates that). Add the three tests from that commit and `.changeset/integration-dialect-aware-guardrails.md` (`@askdb/core` patch, `@askdb/studio` patch).
- Test: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/ask.test.ts src/sql/tenant-placeholders.test.ts` → pass, including `ask.test.ts` "lexes the SQL with the call's dialect" and `tenant-placeholders.test.ts` "… on MySQL: a placeholder inside a backslash-escaped string literal is untouched" and "placeholders inside comments are not substituted, including MySQL # comments"; then `pnpm --filter @askdb/studio test`.

### Check (d): #192's chunk-id test uses #193's schema-scoped id format (#201 fix 1)

- Check: `git grep -n '"chunk:table:public.orders' -- packages/rag/src/chunker/chunker.test.ts` and `git grep -n "chunk:orders-users:table:public.orders" -- packages/rag/src/chunker/chunker.test.ts`
- Expected: first → no output; second → several lines including the three in `describe("front-matter sensitivity escalation (core loader)")`.
- Missing looks like: `"chunk:table:public.orders#status"` / `"chunk:table:public.orders"` in that describe (and `@askdb/rag` tests fail).
- Fix: replace with `"chunk:orders-users:table:public.orders#status"` (twice) and `"chunk:orders-users:table:public.orders"`. **Leave** the `chunk:table:` ids in `indexer/index.test.ts`, `indexer/lock-file.test.ts`, `stores/pgvector.test.ts` — they are deliberate legacy-id fixtures from #193.
- Test: `pnpm --filter @askdb/rag exec vitest run --config ../../vitest.config.ts src/chunker/chunker.test.ts` → pass.

### Check (e): Prisma stays lazy *inside* `@askdb/prisma`, and the CLI uses #199's registry (#201 fix 2; #183 × #199)

- Check:
  ```bash
  git grep -nE '^import .*from "@prisma/internals"|import\("@prisma/internals"\)|await loadPrismaInternals' -- packages/prisma/src
  git grep -n "prismaConnectorProvider" -- apps/cli/src/introspect.ts
  git ls-files .changeset/prisma-lazy-internals.md
  ```
- Expected: first → only the dynamic `import("@prisma/internals")` inside `function loadPrismaInternals()` and `const { getConfig, getDMMF } = await loadPrismaInternals();` inside `describePrismaSchema()` — **no** static `import … from "@prisma/internals"`; second → the `import { prismaConnectorProvider } from "@askdb/prisma";` line and its entry in `export const defaultConnectorRegistry: ConnectorRegistry = createConnectorRegistry([`; third → listed.
- Missing looks like either (1) #183 won: `introspect.ts` does `await import("@askdb/prisma")` and the registry lacks `prismaConnectorProvider` (so `--engine prisma` bypasses `resolveEngine`/`resolveConnection`); or (2) #199 won without the fix: `packages/prisma/src/prisma.ts` has `import prismaInternals from "@prisma/internals";` (every CLI command pays the load).
- Fix: keep #199's `defaultConnectorRegistry` with `prismaConnectorProvider` and `registry.createConnector(...)` in `apps/cli/src/introspect.ts` (drop any dynamic import of `@askdb/prisma`); in `prisma.ts` replace the static import with a memoized `loadPrismaInternals()` (`prismaInternalsPromise ??= import("@prisma/internals").then((mod) => mod.default ?? mod)`) used inside `describePrismaSchema()`; add `.changeset/prisma-lazy-internals.md` (`@askdb/prisma` patch, `askdb` patch). Reference: `git diff 9992fe7^1 9992fe7 -- packages/prisma/src/prisma.ts apps/cli/src/introspect.ts` on the integration branch.
- Test: `pnpm --filter @askdb/prisma test && pnpm --filter askdb test` → pass.

### Check (f): package READMEs use absolute GitHub links (#201 fix 3; #183 × #198/#199/#189)

- Check: `git grep -nE '\]\(\.\./' -- 'packages/*/README.md' 'apps/*/README.md'`
- Expected: no output. (Do **not** grep for `](./` — the `[LICENSE](./LICENSE)` / `[NOTICE](./NOTICE)` links are intentional; each package ships its own copies.)
- Missing looks like: e.g. `packages/ai-openai/README.md:3:> **Deprecated.** … [\`@askdb/ai\`](../ai) …`, `packages/connectors/README.md` linking `../introspect/README.md` or `../../docs/adrs/…`, `packages/introspect/README.md` linking `../../docs/integration/connectors.md#…`, `packages/postgres/README.md` linking `../../docs/adrs/0003-postgres-partition-handling.md`.
- Why: npm renders each README from the tarball (`files: ["dist","README.md","LICENSE","NOTICE"]`), where `../` points outside the package and 404s.
- Fix: rewrite each to `https://github.com/Ygilany/AskDB/tree/main/<dir>` (directories) or `https://github.com/Ygilany/AskDB/blob/main/<file>` (files), as integration commit `a8bb7b7` did.
- Test: the grep is the test.

### Check (g): the new live-DB suites use `integrationSuite()` (#201 fix 5; #180 × #189/#197)

- Check:
  ```bash
  git grep -n "integrationSuite(" -- packages/postgres/src/connector/partition-fk.integration.test.ts packages/sqlite/src/exec/tenant-binding.exec.test.ts
  git grep -nE '\? *describe *: *describe\.skip|describe\.(skip|skipIf|runIf)\b|it\.skipIf' -- 'packages/**/*.test.ts' 'apps/**/*.test.ts'
  git grep -L "integrationSuite(" -- '*.integration.test.ts' '*.live.test.ts' '*.exec.test.ts'
  ```
- Expected: first → two lines (`const suite = integrationSuite({ env: ["DATABASE_URL"] });` and `const suite = integrationSuite({ unavailable: probe ? null : "better-sqlite3 could not be loaded" });`); second → no output; third → only `apps/http-api/src/server.integration.test.ts` (an in-process HTTP test with no DB prerequisites — correctly ungated). Any other file in the second or third output is a suite that bypasses fail-on-skip: fix it the same way.
- Missing looks like: `const suite = url ? describe : describe.skip;` / `const suite = probe ? describe : describe.skip;`.
- Fix: import `integrationSuite` from `../../../../scripts/test-utils/integration.mjs`, drop `describe` from the vitest import, use `integrationSuite({ env: ["DATABASE_URL"] })` (Postgres) / `integrationSuite({ unavailable: probe ? null : "…" })` (SQLite). Reference commit `4680bf2`.
- Test: `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/connector/partition-fk.integration.test.ts` with `DATABASE_URL` unset → **fails** with "has its integration prerequisites" (proves the gate); with `DATABASE_URL` set to the Pagila/Postgres fixture (see `CONTRIBUTING.md` → Integration Tests) → passes.

### Step 8: whole-repo confirmation

`pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm preflight` → exit 0 on `main` (plus your branch if fixes were needed). Then confirm the latest `main` CI run's `test` job actually ran the DB suites: `gh run list --repo Ygilany/AskDB --workflow CI --branch main --limit 1` → success, and its `test` job log shows the MySQL/SQL Server/pgvector/Pagila suites executing (not skipped).

### Step 9: known leftover (not one of the seven)

Also check the optional #190 × #197 tweak added after #201 was built (#197 commit `886670c`): `git grep -n 'rejectCaseVariantTenantPlaceholders(sql, dialect)' -- packages/core/src/sql/tenant-placeholders.ts`. If it has no match, don't fix it here — plan 055 (item 3 of its "Update after #197 `886670c`" section) owns it.

#201 intentionally left root `AGENTS.md` unchanged: its Conventions still say "`@askdb/ai-*` adapters and raw Vercel AI SDK `LanguageModel` objects are both first-party…" and "Provider adapters declare `ai` and `@askdb/ai` as peer dependencies…", which are stale after #198 folded the adapters into `@askdb/ai`. Check: `git grep -n "@askdb/ai-\*" -- AGENTS.md`. If present, draft the replacement wording (built-in providers in `@askdb/ai`; third-party `AiProviderAdapter`) in the PR description for the maintainer to apply — AGENTS.md is agent-instruction policy, so a human approves the text.

### Step 10 [HUMAN]: retire #201

After all checks pass (or the fix PR merged):
```bash
gh pr comment 201 --repo Ygilany/AskDB --body "All 7 composition fixes verified on main (plan 071): a-g all OK. Closing."
gh pr close 201 --repo Ygilany/AskDB
git push origin --delete review/integration-check
```
Also remove any local worktree of that branch (e.g. `git worktree list | grep integration-check` → `git worktree remove <path>`).

## Test plan

No new tests unless a fix is re-applied; then use the tests named in that item (they come from the original commits and were written against the owning boundary). The fail-on-skip run in (g) is the proof the CI gate works.

## Docs impact

None, unless Step 9's AGENTS.md wording is applied.

## Changeset guidance

Only if (c) or (e) must be re-applied: add the changeset file named there (patch bumps). Check `pnpm changeset status` for no major bumps.

## Done criteria

- [ ] Checks (a)–(g) each ticked with the command output pasted in the PR (or in the #201 closing comment if no PR was needed)
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm preflight` exit 0 on `main`
- [ ] Latest `main` CI `test` job ran (not skipped) the DB suites
- [ ] Step 9 wording drafted (or AGENTS.md already current)
- [ ] [HUMAN] #201 closed, `review/integration-check` deleted

## STOP conditions

- A PR in #180–#205 (other than #201) was closed without merging — the matching fix may no longer apply; ask which.
- A check fails and the surrounding code no longer resembles the "Expected" excerpt (the area was refactored after the review) — report instead of forcing the old fix in.
- Re-applying `9374227` conflicts with later changes to `tenant-placeholders.ts` beyond the `nextIndex` note.
- `ASKDB_REQUIRE_INTEGRATION=1` makes an unrelated suite fail for missing prerequisites in CI — that's a CI env gap (turbo `tasks.test.env` in `turbo.json`), report it.

## Maintenance notes

- New live-database suites must use `integrationSuite()`; the grep in (g) is worth adding to CI (e.g. a line in `scripts/release-preflight.sh`) — deferred.
- Once `review/integration-check` is deleted, commits `01cf788`, `c7404d4`, `9374227`, `55eb6b8`, `9992fe7`, `28a6c0e`, `a8bb7b7`, `4680bf2` become unreachable by name; copy anything you still need before Step 10.
