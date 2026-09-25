# Plan 065: Let Studio execute block queries that read sensitive columns (`studio.execute.sensitiveGuardrailMode: "strict"`)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> gh pr view 194 --repo Ygilany/AskDB --json state -q .state   # → MERGED (Studio execute hardening: sensitiveExecuteWarnings, studio.execute.maxRows)
> gh pr view 190 --repo Ygilany/AskDB --json state -q .state   # → MERGED (dialect-aware lexer; validateSensitiveReferences takes `dialect`)
> git grep -n "function sensitiveExecuteWarnings" -- apps/studio/src/server.ts          # → 1 match
> git grep -n "Warn (never block) when the SQL references identifiers marked" -- apps/studio/src/server.ts   # → 1 match (the problem still exists)
> git grep -n "sensitiveGuardrailMode" -- packages/config/src apps/studio/src           # → no matches (nobody has added the key yet)
> git grep -n "export type SensitiveGuardrailMode" -- packages/core/src/sql/sensitive-guardrail.ts   # → 1 match
> ```
>
> If the last-but-one grep finds matches, someone already started this — compare with the "Current state" excerpts and STOP on a mismatch.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — new opt-in key; the default (`"warn"`) is today's behavior byte for byte.
- **Depends on**: PR #194 (Studio execute hardening) and PR #190 (dialect-aware lexer) merged. No plan dependencies.
- **Category**: security
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No — additive config key with a default equal to current behavior; `ExecuteStatusResponse` gains a field (Studio's own browser↔server DTO, not a public package API).

## Why this matters

Studio's Playground can run generated SQL against a live database (`POST /api/execute`). Since #194 it runs `validateSensitiveReferences` over the SQL first, but only ever in `"warn"` mode: a query that selects a column the schema marks `sensitive` (e.g. `users.email`) still executes and the rows come back to the browser, with a warning string appended. There is no way for a team to say "in this Studio, never pull sensitive columns" — `@askdb/core` already has the strict behavior (`SensitiveReferenceError`), and `ask()` exposes it as `sensitiveGuardrailMode: "strict"`, but Studio's config has no key and the server hard-codes `mode: "warn"`.

After this plan, `studio.execute.sensitiveGuardrailMode: "strict"` makes Studio refuse such queries with HTTP 422 before anything reaches the driver, and the Playground shows why.

## Current state

Verified on `review/integration-check @ c7404d4`. Line numbers will drift after real merges — match on the quoted code.

### Studio server: the warn-only check

`apps/studio/src/server.ts`, inside `async function executeQuery(body: unknown, schemaDir: string): Promise<ExecuteResponse>` (after `validateExecuteSql`):

```ts
  const warnings = sensitiveExecuteWarnings(
    sql,
    schemaDir,
    executeDialectFor(exec.provider, rt.nlToSql.dialect),
  );
  const projectRoot = findProjectRoot(schemaDir) ?? schemaDir;
  const def = EXECUTE_DRIVER_REGISTRY[exec.provider];
  const result = await def.execute({
    ...
  });
  ...
  return result.ok && warnings.length > 0 ? { ...result, warnings } : result;
}

/**
 * Warn (never block) when the SQL references identifiers marked `sensitive` —
 * the same check `ask()` runs in its default `"warn"` mode. Studio has no
 * strict-mode setting; hosts that need enforcement call
 * `validateSensitiveReferences(sql, schema, { mode: "strict" })` themselves.
 */
function sensitiveExecuteWarnings(
  sql: string,
  schemaDir: string,
  dialect: DialectSpec,
): string[] {
  let schema: ReturnType<typeof loadSchema>;
  try {
    schema = loadSchema(schemaDir);
  } catch {
    return [];
  }
  if (!schemaHasSensitiveIdentifiers(schema)) return [];
  const result = validateSensitiveReferences(sql, schema, { mode: "warn", dialect });
  if (result.references.length === 0) return [];
  return [
    `This query reads identifiers marked sensitive: ${result.references.map(formatSensitiveReference).join(", ")}.`,
  ];
}
```

Errors thrown as `new StudioHttpError(status, message)` (class at the bottom of `server.ts`) are turned into `writeJson(res, status, { error: { message } })` by the catch block in `createStudioServer`. `SqlValidationError` from the read-only check is already mapped to 400 the same way, just above.

`getExecuteStatus(schemaDir)` in the same file builds the `ExecuteStatusResponse` (`enabled`, `disabledReason`, `timeoutMs`, `maxRows`, `provider`, …) that the Playground reads.

### Core: the modes that already exist

`packages/core/src/sql/sensitive-guardrail.ts`:

```ts
export type SensitiveGuardrailMode = "warn" | "strict";
...
export function validateSensitiveReferences(sql, schema, options?): SensitiveGuardrailResult {
  const mode = options?.mode ?? "warn";
  ...
  if (mode === "strict" && !result.passed) {
    throw new SensitiveReferenceError(buildStrictMessage(result), ruleFor(result), result.references, result.unresolvedScope);
  }
```

`SensitiveReferenceError` (`packages/core/src/errors.ts`) has `rule: "SENSITIVE_TABLE_REFERENCED" | "SENSITIVE_COLUMN_REFERENCED" | "UNRESOLVED_TABLE_SCOPE"`, `references`, `unresolvedScope`. It is exported from `@askdb/core`. `ask()` exposes `sensitiveGuardrailMode?: SensitiveGuardrailMode | "off"` (`packages/core/src/ask.ts`). Note strict fails on **unresolved scope** too (`passed` is false), not only on found references.

### Config: `studio.execute` has no such key

`packages/config/src/types.ts`, `AskDbConfig["studio"]["execute"]` has `enabled`, `useIntrospectionConnection`, `timeoutMs`, `maxRows`, `provider`, `databaseUrl`, `file`. Each key follows the same three-place pattern — copy it exactly:

1. **Type + JSDoc** in `types.ts` (JSDoc ends with `Maps to \`ASKDB_STUDIO_EXECUTE_…\`.`).
2. **Flatten** in `packages/config/src/flatten.ts` (the `// --- Studio ---` block): validate and `set(out, "ASKDB_STUDIO_EXECUTE_…", …)`, throwing `askdb.config: studio.execute.<field> must be …` on a bad structured value. Exemplar: the `enabled` / `useIntrospectionConnection` blocks.
3. **Resolve** in `packages/config/src/runtime-config.ts`, `function resolveStudioExecuteConfig(structured, flat)`, which returns `{ provider, databaseUrl, file, enabled, useIntrospectionConnection, introspectionConnectionAvailable, timeoutMs, maxRows }` — structured value first, then `pickFlat(flat, "ASKDB_STUDIO_EXECUTE_…")`, then a default. The runtime type is `AskDbRuntimeStudioConfig["execute"]` in the same file (fields documented with `/** … Default … */`).

`@askdb/config` does **not** depend on `@askdb/core`, so it cannot import `SensitiveGuardrailMode`; define the union locally (constants live in `packages/config/src/constants.ts`, e.g. `ASKDB_STUDIO_EXECUTE_PROVIDERS`).

`modes` (`modes?: { askdbMode?: AskDbModeV1; omitSensitiveFromPrompt?: boolean }`) is the only other sensitivity-related key; it is read by the CLI, HTTP API and client facade.

### Web UI

`apps/studio/src/web/contexts/playground-context.tsx` `handleExecute()` calls `executeQuery(...)` from `web/api.ts`; `api()` throws `new Error(body.error.message)` on any non-2xx response and `handleExecute` renders it as `{ kind: "error", text }`. So a 422 with a good message is shown with no web change. `apps/studio/src/web/views/playground/PlaygroundPage.tsx` renders the Execute button with ``title={`Runs read-only · ${Math.round(executeStatus.timeoutMs / 1000)}s timeout · first ${executeStatus.maxRows} rows`}``.

### Existing tests to extend

- `apps/studio/src/server.test.ts`, `describe("execute against a real SQLite database")` → `it("warns (without blocking) when the SQL reads a column marked sensitive")` uses `startSqliteServer(createSqliteDb(1))` and `postJson(`${baseUrl}/api/execute`, { sql: "SELECT email FROM users" })`. The fixture (`fixtures/schemas/orders-users.schema`) marks `users.email` sensitive. `startSqliteServer(file, execute)` spreads `execute` into `studio.execute`.
- `packages/config/src/config.test.ts`, `describe("getAskDbRuntimeConfig — studio execute safety defaults")` (its `install(studio, flatExtra)` helper) with `it("is disabled by default with 30s timeout and 500-row cap")`, `it("flattens enabled, timeoutMs, and maxRows to canonical keys")`, `it("reads the canonical flat keys")`, `it("rejects non-positive-integer timeoutMs / maxRows")`.

## Decision: key name and placement

Use **`studio.execute.sensitiveGuardrailMode?: "warn" | "strict"`**, default `"warn"`, env key **`ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE`**.

- Same name and values as core's `AskPipelineOptions.sensitiveGuardrailMode`, so docs can say "same meaning as in `ask()`".
- **Not** `"off"`: Studio's check is cheap and only warns by default; there is no reason to let config silence it.
- **Not** under `modes`: `modes` is global and read by the CLI, HTTP API and `@askdb/client`. A global key that only Studio honored would imply enforcement those surfaces don't do. Wiring it into the other surfaces is a separate decision (see Maintenance notes).
- Scoped to **execute** only: `/api/ask` keeps generating SQL (with the default `"warn"` guardrail inside `ask()`); a schema author needs to see what the model produced. Blocking at execution is what keeps sensitive values out of the browser.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build | `pnpm build` | exit 0 (packages resolve each other through `dist`) |
| Config tests | `pnpm --filter @askdb/config exec vitest run --config ../../vitest.config.ts src/config.test.ts` | all pass |
| Studio server tests | `pnpm --filter @askdb/studio exec vitest run --config ../../vitest.config.ts src/server.test.ts` | all pass |
| Lint (incl. Studio web typecheck) | `pnpm lint` | exit 0 |
| Full tests | `pnpm test` | exit 0 |
| Docs | `pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `packages/config/src/constants.ts`, `types.ts`, `flatten.ts`, `runtime-config.ts`, `index.ts` (export the new constant/type), `config.test.ts`
- `apps/studio/src/server.ts`, `apps/studio/src/shared/api.ts`, `apps/studio/src/server.test.ts`
- `apps/studio/src/web/views/playground/PlaygroundPage.tsx` (button title only)
- `apps/docs-site/src/content/docs/reference/config.mdx`, `apps/docs-site/src/content/docs/studio.mdx`, `apps/studio/README.md`, `docs/contracts/sensitive-fields-and-modes.md`
- `.changeset/studio-execute-sensitive-strict.md` (create)

**Out of scope** (do NOT touch):
- `/api/ask` / `askSampleQuestion` — do not pass `sensitiveGuardrailMode` to `ask()` (see Decision).
- `modes`, the HTTP API, `@askdb/client`, the CLI — no global sensitive-enforcement key in this plan.
- `packages/core` — the guardrail itself is unchanged.
- `apps/studio/src/execute-registry.ts` and the drivers — the check must run before them, not inside them.
- Any wider refactor of `server.ts` (plan 066 decomposes it; if 066 already landed, put the new code in whatever module now owns execute and note it in the PR).

## Git workflow

- Branch: `plan/065-studio-execute-strict-sensitive-mode`
- Conventional commits, e.g. `feat(studio): studio.execute.sensitiveGuardrailMode "strict" blocks sensitive-column queries`
- One PR; do not merge it.

## Steps

### Step 1: Add the config key (type, constant, flatten, runtime)

1. `constants.ts`: add
   ```ts
   export const ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODES = ["warn", "strict"] as const;
   export type AskDbStudioExecuteSensitiveGuardrailMode = (typeof ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODES)[number];
   ```
   and export both from `index.ts` next to `ASKDB_STUDIO_EXECUTE_PROVIDERS`.
2. `types.ts`: add to `studio.execute`:
   ```ts
   /**
    * What Studio does when an executed query references tables/columns marked `sensitive`
    * (same meaning as `ask()`'s `sensitiveGuardrailMode`). `"warn"` (default) runs the query
    * and returns a warning; `"strict"` refuses it with HTTP 422 before it reaches the database,
    * including when the statement's table scope cannot be resolved.
    * Maps to `ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE`.
    */
   sensitiveGuardrailMode?: AskDbStudioExecuteSensitiveGuardrailMode;
   ```
3. `flatten.ts`, in the `studioExecute` block: if the field is defined and not in the allowlist, throw `askdb.config: studio.execute.sensitiveGuardrailMode must be "warn" or "strict" (got <JSON>).`; otherwise `set(out, "ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE", value)`.
4. `runtime-config.ts`: add `sensitiveGuardrailMode: AskDbStudioExecuteSensitiveGuardrailMode;` (JSDoc `Default "warn".`) to the runtime execute type, and resolve it in `resolveStudioExecuteConfig`: structured value → flat value (trimmed, lower-cased) → `"warn"`. A flat value that is present but not `warn`/`strict` resolves to **`"strict"`** (fail closed — a typo such as `stirct` must not silently disable enforcement). Put a one-line comment saying so.

**Verify**: `pnpm --filter @askdb/config build && pnpm --filter @askdb/config lint` → exit 0.

### Step 2: Config tests (extend, don't duplicate)

In `packages/config/src/config.test.ts`, `describe("getAskDbRuntimeConfig — studio execute safety defaults")`:
- Extend `it("is disabled by default …")` with `expect(exec.sensitiveGuardrailMode).toBe("warn")`.
- Extend `it("flattens enabled, timeoutMs, and maxRows to canonical keys")` (rename to `"flattens studio.execute fields to canonical keys"`) with `sensitiveGuardrailMode: "strict"` → `flat.ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE === "strict"`.
- Extend `it("reads the canonical flat keys")` with `ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE: "strict"` → `"strict"`.
- Add one test: an unrecognized flat value (`"stirct"`) resolves to `"strict"`, and a bad structured value throws `/studio\.execute\.sensitiveGuardrailMode/` at flatten time (fold this into `it("rejects …")` as an extra `expect` rather than a new `it`).

**Verify**: config test command → all pass.

### Step 3: Enforce in Studio execute

In `apps/studio/src/server.ts`:
1. Replace `sensitiveExecuteWarnings(sql, schemaDir, dialect)` with `checkSensitiveExecute(sql, schemaDir, dialect, exec.sensitiveGuardrailMode): string[]`:
   - `"warn"`: exactly today's behavior (returns the same warning string; schema load failure → `[]`).
   - `"strict"`: if `loadSchema(schemaDir)` throws → `throw new StudioHttpError(422, "Studio execute is in strict sensitive-column mode (studio.execute.sensitiveGuardrailMode) and could not load the schema to check this query.")` (fail closed). If `!schemaHasSensitiveIdentifiers(schema)` → `[]`. Otherwise call `validateSensitiveReferences(sql, schema, { mode: "strict", dialect })`; catch `SensitiveReferenceError` (import it from `@askdb/core`; use `instanceof`) and throw `new StudioHttpError(422, \`Blocked: this query reads identifiers marked sensitive (${error.rule}): ${refs}. Studio execute is in strict mode (studio.execute.sensitiveGuardrailMode: "strict").\`)` where `refs` is `error.references.map(formatSensitiveReference).join(", ")`, or — when `references` is empty (the `UNRESOLVED_TABLE_SCOPE` case) — `error.message`. Re-throw anything else.
2. The call must stay **before** `def.execute(...)`. Update the JSDoc to describe both modes (delete "Studio has no strict-mode setting").
3. `getExecuteStatus`: add `sensitiveGuardrailMode: exec.sensitiveGuardrailMode` to the returned object; add the field to `ExecuteStatusResponse` in `apps/studio/src/shared/api.ts` with a JSDoc line.
4. `PlaygroundPage.tsx`: append `· sensitive columns blocked` to the Execute button `title` when `executeStatus.sensitiveGuardrailMode === "strict"`. No other web change — the 422 message already surfaces through `handleExecute`'s catch.

**Verify**: `pnpm --filter @askdb/studio build && pnpm --filter @askdb/studio lint` → exit 0.

### Step 4: Studio server tests

In `describe("execute against a real SQLite database")`, next to the existing "warns (without blocking)" test, add **one** `it` that starts the server with `startSqliteServer(<path that does not exist>, { sensitiveGuardrailMode: "strict" })` and asserts, using `postRaw`:
- `SELECT email FROM users` → status `422`, `error.message` contains `users.email` and `strict`.
- `SELECT id FROM users` → **not** 422 (the driver runs; with a missing file it returns 200 `{ ok: false }` — asserting "not 422" proves the non-sensitive query passes the guard).

Using a nonexistent file is the proof the guard runs first: had the driver been reached for the email query, the response would be the driver's 200 `{ ok: false, … }`, not 422. If `startSqliteServer`'s signature does not accept extra `execute` fields, widen its parameter type (test-only helper) rather than adding a new helper.

Authoring gate (`.agents/skills/test-audit/SKILL.md`): (1) protects "strict mode never executes a sensitive query and says why"; (2) fails if the check moves after `def.execute`, is skipped in strict mode, or the mode is not threaded from config; (3) no existing test covers strict (only warn); (4) no production seam needed — it uses the public HTTP boundary. The existing warn test stays as the owner of the default.

**Verify**: Studio server test command → all pass, 1 new test.

### Step 5: Docs

- `reference/config.mdx`: add a row to the `studio.execute` table: `` `studio.execute.sensitiveGuardrailMode` | `ASKDB_STUDIO_EXECUTE_SENSITIVE_GUARDRAIL_MODE` | `"warn"`. `"strict"` refuses queries that read `sensitive` tables/columns (or whose table scope can't be resolved) with `422` instead of running them. `` and a commented line `// sensitiveGuardrailMode: "strict",` in the example block.
- `studio.mdx`: in the "Validated first." bullet, replace "If the query reads a column marked `sensitive`, the result shows a warning but still runs." with a sentence covering both modes and the key; add `// sensitiveGuardrailMode: "warn", // "strict" blocks sensitive-column queries` to the Playground config example.
- `apps/studio/README.md`: one sentence in the execute paragraph.
- `docs/contracts/sensitive-fields-and-modes.md`, "In the pipeline." paragraph: one sentence that Studio execute runs the same check, `warn` by default, `strict` via `studio.execute.sensitiveGuardrailMode`.

**Verify**: `pnpm docs:build` → exit 0; `git grep -n "shows a warning but still runs" -- apps/docs-site` → no matches.

### Step 6: Changeset and gates

Create `.changeset/studio-execute-sensitive-strict.md`: `"@askdb/config": minor` (new config key + exported constant — additive, but minor is this repo's convention for new config surface; see `.changeset/studio-execute-hardening.md`) and `"@askdb/studio": minor`. Body: one paragraph describing the key, default, 422 behavior, fail-closed rules.

Then run `pnpm changeset status` and read the planned bumps. With pre mode (`.changeset/pre.json`, tag `beta`) and `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`, no package should be bumped to a new **major**; if one is, STOP.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → all exit 0.

## Test plan

- `packages/config/src/config.test.ts`: extend four existing `studio.execute` tests (default, flatten, flat read, rejection); no new `it` except none-or-one for the fail-closed flat value if it doesn't fold cleanly. Owner boundary: config resolution.
- `apps/studio/src/server.test.ts`: one new HTTP-level test (Step 4). Owner boundary: `POST /api/execute`. Regression caught: strict mode not enforced / enforced after execution / not threaded from config.
- Do not add tests for `checkSensitiveExecute` directly (private helper; the HTTP test owns it) and do not re-test core's strict semantics (owned by `packages/core/src/sql/sensitive-guardrail*.test.ts`).

## Docs impact

Per AGENTS.md the docs site must stay accurate: `apps/docs-site/src/content/docs/reference/config.mdx` (table + example) and `apps/docs-site/src/content/docs/studio.mdx` (security model bullet + example). Also `apps/studio/README.md` and `docs/contracts/sensitive-fields-and-modes.md`.

## Changeset guidance

`@askdb/config` minor, `@askdb/studio` minor (pre-1.0 convention: new public surface = minor). The repo is in pre mode (`beta`), so this produces `-beta.N` bumps. Run `pnpm changeset status` and confirm no unexpected major bumps for peer-dependents.

## Done criteria

- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight` all exit 0
- [ ] `git grep -n "sensitiveGuardrailMode" -- packages/config/src/types.ts packages/config/src/flatten.ts packages/config/src/runtime-config.ts apps/studio/src/server.ts apps/studio/src/shared/api.ts` → matches in all five files
- [ ] `git grep -n "Studio has no strict-mode setting" -- apps/studio/src` → no matches
- [ ] New Studio test passes and asserts status 422 for the sensitive query with a nonexistent SQLite file
- [ ] Default config still returns `warnings` for `SELECT email FROM users` (existing test green, unchanged)
- [ ] `.changeset/studio-execute-sensitive-strict.md` exists; `pnpm changeset status` shows no major bumps
- [ ] `git status` shows only in-scope files modified

## STOP conditions

- Readiness check fails (PRs not merged, or `sensitiveExecuteWarnings` no longer exists / already has a strict path).
- `validateSensitiveReferences` no longer throws `SensitiveReferenceError` in strict mode, or `SensitiveReferenceError` is not exported from `@askdb/core`.
- The new strict test returns 200 for the sensitive query (the guard is being bypassed) and the cause isn't an obvious wiring slip in your change.
- `pnpm changeset status` proposes a major bump for any package.
- Plan 066 has partially moved execute code and it's unclear which module owns `executeQuery` — report rather than editing two copies.

## Maintenance notes

- If plan 066 lands first, `checkSensitiveExecute` lives in the execute module it creates; the HTTP test is unaffected.
- Follow-up (deliberately deferred): whether the HTTP API / `@askdb/client` should get a config-level `sensitiveGuardrailMode` too (they currently pass nothing, so `ask()` uses `"warn"`). If added, consider a global key and make Studio's key default to it.
- Reviewer focus: the guard must run before `def.execute`; strict must fail closed on schema-load failure and on unresolved scope; `"warn"` output must be unchanged.
