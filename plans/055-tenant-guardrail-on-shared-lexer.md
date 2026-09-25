# Plan 055: Rebuild the tenant guardrail's scanner on the shared dialect-aware lexer, and derive placeholder names in one place

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> gh pr view 190 --repo Ygilany/AskDB --json state -q .state   # → MERGED (shared lexer)
> gh pr view 197 --repo Ygilany/AskDB --json state -q .state   # → MERGED (local normalizeSql)
> git grep -n 'export function lexSql' -- packages/core/src/sql/lexer.ts                         # → 1 match
> git grep -n 'scanTenantPlaceholders(sql, lexerDialect(dialect))' -- packages/core/src/sql/tenant-placeholders.ts  # → matches (#201 composition fix 4 landed)
> git grep -n 'function normalizeSql' -- packages/core/src/sql/tenant-guardrail.ts               # → 1 match (problem still present)
> git grep -n 'tenant_${rootLabel.toLowerCase()' -- packages/core/src/sql/tenant-guardrail.ts packages/core/src/sql/tenant-prompt.ts  # → 4 matches
> ```

## Status

- **Priority**: P1. Two reachable fail-opens in `ask()` on MySQL, shown below.
- **Effort**: M
- **Risk**: MED. The guardrail's verdicts change for MySQL, and for any SQL whose strings or comments the old scanner misread.
- **Depends on**: #190, #197, and #201's composition fix 4 (dialect threading) applied during the real merges.
- **Category**: security
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No public type removal. `validateTenantGuardrails` gains an optional 4th `options` argument. Verdicts get stricter for dialect-specific strings and for case-variant placeholders. Ship as a **patch** changeset for `@askdb/core`.

## Why this matters

The tenant guardrail is a heuristic lint. Its whole value depends on reading the statement's code regions correctly. #197 gave it a local, hand-written scanner (`normalizeSql`), because the tokenizer back then had no comment handling. #190 then added the dialect-aware lexer (`lexer.ts`), and #201 threaded the dialect into `ask()`'s sensitive guardrail and the tenant placeholder scanner. The tenant guardrail still ignores the dialect. Its own doc comment says so ("Known gaps (no dialect is threaded here): MySQL's default double-quoted strings read as identifiers, and backslash escapes inside '…' are not recognized").

Verified on c7404d4 with the `agency-multi-tenant` fixture (`enforcement: strict`) and `ask({ dialect: "mysql", ... })`. The model's SQL passes `validateSelectSql` for MySQL, and **`ask()` returns unscoped SQL with `tenantGuardrail: { passed: true }`**:

- `SELECT * FROM orders WHERE status = "agency_id"`: MySQL reads `"agency_id"` as a string. The guardrail reads it as the identifier `agency_id`.
- `SELECT * FROM orders WHERE status = 'it\'s agency_id'`: MySQL reads one string literal. The guardrail ends the string at `\'` and sees `agency_id` as code.

A third, related drift: `SELECT * FROM orders WHERE owner_ref IN (:TENANT_AGENCY_IDS)` with dialect `postgres` returns the SQL **with the raw, unsubstituted placeholder** and `passed: true`. The guardrail lowercases the statement and counts `:tenant_agency_ids` as present. Substitution uses `scanTenantPlaceholders`, whose token regex is lowercase-only, so it never sees the placeholder. This breaks the documented contract "SQL with an unsubstituted placeholder is never returned" (`docs/contracts/tenant-policy.md`, Enforcement rules). It fails loudly at the database, but it shows the guardrail and the substituter disagree about what a placeholder is.

Placeholder names are also built with the same inline regex in four places, instead of calling `placeholderForRoot`.

## Current state

- `packages/core/src/sql/tenant-guardrail.ts`:
  - `validateTenantGuardrails(sql, policy, scope)` has no dialect parameter. It calls `normalizeSql(sql)`, a length-preserving scanner that lowercases and blanks `'…'` (with `''` only), `$tag$…$tag$`, `--` and `/* */`. It keeps `"…"`, `` `…` `` and `[…]` contents as identifiers.
  - `checkScopedTable` builds placeholders inline twice: `` const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`; ``
  - `mentionsPlaceholder` matches `(?<![\w:])<placeholder>(?!\w)` against the **lowercased** text.
  - `enforceTenantGuardrails(sqls, policy, scope, logger?, extra?)` is internal (not in `index.ts`). It's called from `packages/core/src/ask.ts` (`enforceTenantGuardrails([result.sql, result.unboundSql], tenantPolicy, options.tenantScope, logger, generated.tenantGuardrail)`) and `packages/core/src/sql/generate.ts` (`enforceTenantGuardrails([sql, unboundNamedSql], deps.tenantPolicy, deps.tenantScope, logger)`). Neither passes a dialect. `ask()` has `dialectSpec` in scope. `generate.ts` has `dialect: DialectSpec`.
- `packages/core/src/sql/tenant-prompt.ts`: the same inline expression appears in the `ids` and `multi_root` branches.
- `packages/core/src/sql/tenant-placeholders.ts`: `export function placeholderForRoot(label: string): string { return `:tenant_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`; }` is already exported from `index.ts`.
- `packages/core/src/sql/lexer.ts`: `lexSql(sql, profile)` gives tokens `{ kind: "word" | "quoted_identifier" | "string" | "number" | "parameter" | "punct" | "comment", text, start, end, quote?, unterminated? }`. `lexerProfileFor(dialect)` returns the engine profile, or `undefined` for unknown ids. `GENERIC_LEXER` is the no-dialect profile. MySQL `/*! … */` bodies come out as code tokens between comment tokens.
- The pattern to copy is `packages/core/src/sql/sensitive-guardrail.ts`. `ValidateSensitiveReferencesOptions` has `dialect?: Pick<DialectSpec, "id" | "backslashEscapes">`, and `scanSql` lexes with `lexerProfileFor(dialect)` when a dialect is known.
- `packages/core/src/sql/bind.ts`: `PLACEHOLDER_TOKEN_RE = /(?<!:):([a-z][a-z0-9_]*)/g` (lowercase only), and `scanTenantPlaceholders` filters `/^tenant_[a-z0-9_]+_ids$/`.
- Tests: `packages/core/src/sql/tenant-guardrail.test.ts` `describe("validateTenantGuardrails — matches only in code regions")` holds the dialect-less cases (all must keep passing) and the two "known limitation" tests (selected column, `OR 1=1`) that plan 050 owns. Leave those unchanged.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Guardrail tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**: `packages/core/src/sql/tenant-guardrail.ts` + test; `packages/core/src/sql/tenant-prompt.ts`; `packages/core/src/sql/tenant-placeholders.ts` + test (Step 4 only); `packages/core/src/ask.ts` and `packages/core/src/sql/generate.ts` (pass the dialect only); `packages/core/src/ask.test.ts` (one regression); `docs/contracts/tenant-policy.md` (guardrail section); `apps/docs-site/src/content/docs/reference/core-api.mdx` (the `validateTenantGuardrails` signature); `.changeset/tenant-guardrail-dialect-lexer.md`.

**Out of scope**: making the guardrail clause-aware (`OR 1=1`, selected-not-filtered). That's plan 050, so keep the two known-limitation tests as they are. Also out: `lexer.ts` and `bind.ts`. Consume them, don't change them; if either needs a change, STOP. And out: the sensitive guardrail.

## Git workflow

Branch `plan/055-tenant-guardrail-lexer`; one commit per step; one PR, don't merge. Style: `fix(core): lex the tenant guardrail with the target dialect`.

## Steps

### Step 1: One source of placeholder names

Replace the four inline expressions (two in `tenant-guardrail.ts` `checkScopedTable`, two in `tenant-prompt.ts`) with `placeholderForRoot(rootLabel)`, imported from `./tenant-placeholders.js`. There's no cycle: `tenant-placeholders.ts` imports only `errors`, `dialect-spec` and `bind`.

**Verify**: `git grep -n 'tenant_${' -- packages/core/src/sql/tenant-guardrail.ts packages/core/src/sql/tenant-prompt.ts` → no matches. `pnpm --filter @askdb/core test` → all pass (no behavior change).

### Step 2: Replace `normalizeSql` with a lexer-backed code view

In `tenant-guardrail.ts`, delete `normalizeSql` and add:

```ts
type CodeView = { text: string; placeholders: ReadonlySet<string> };
/** Lowercased, same-length copy of `sql` where string and comment tokens are blanked (newlines kept) and quoted-identifier delimiters are blanked (contents kept), plus the exact text of every `parameter` token. */
function codeView(sql: string, profile: SqlLexerProfile): CodeView;
```

- Build it from `lexSql(sql, profile)`. For `string` and `comment` tokens, blank `start..end` (keep `\n`). For `quoted_identifier`, blank the opening delimiter char and, if the token isn't `unterminated`, the closing one. Collect `parameter` token `text` into `placeholders`, **case-sensitive**.
- Profile: `dialect ? lexerProfileFor(dialect) ?? GENERIC_LEXER : GENERIC_LEXER`. Without a dialect the behavior matches today's generic reading. Document that `ask()` passes the dialect whenever it has a `DialectSpec`, and that a custom `AskDialect` gets the generic reading.
- `mentionsTable` and `mentionsIdentifier` keep their `\b…\b` regexes over `view.text`. `mentionsPlaceholder(view, placeholder)` becomes `view.placeholders.has(placeholder)`, which is the same rule the substituter uses (lowercase, exact).
- Rewrite the function's doc comment. Remove the "Known gaps (no dialect is threaded here)" paragraph. Say that regions are lexed the way the target engine reads them, and that without a dialect the generic profile is used.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts` → all existing cases pass unchanged.

### Step 3: Thread the dialect

- `validateTenantGuardrails(sql, policy, scope, options?: { dialect?: Pick<DialectSpec, "id" | "backslashEscapes"> })`: the public signature grows by one optional argument, named like `ValidateSensitiveReferencesOptions.dialect`.
- `enforceTenantGuardrails(sqls, policy, scope, logger?, extra?, dialect?)` passes it through.
- `ask.ts` passes `dialectSpec`. `generate.ts` passes `dialect`.

**Verify**: `git grep -n 'enforceTenantGuardrails(' -- packages/core/src/ask.ts packages/core/src/sql/generate.ts` → both calls pass a dialect argument. `pnpm --filter @askdb/core lint` → exit 0.

### Step 4: Fail closed on case-variant tenant placeholders

In `tenant-placeholders.ts` `resolveTenantSql`, on the non-`global` path before substitution: scan the code regions (`tokenizeSqlSpans(sql, lexerDialect(dialect))`, spans of kind `"code"`) for `/(?<!:):(tenant_[a-z0-9_]+_ids)\b/gi`. Throw `TenantScopeError` with reason `UNRESOLVED_TENANT_PLACEHOLDER` for any match whose text isn't all lowercase: "tenant placeholders must be lowercase (`:tenant_agency_ids`); refusing to return SQL with an unsubstituted placeholder". Don't make substitution itself case-insensitive. The prompt tells the model the exact lowercase name.

**Verify**: `pnpm --filter @askdb/core test` → all pass.

### Step 5: Tests

Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`). Owner: `validateTenantGuardrails` in `tenant-guardrail.test.ts`, for lexing verdicts. Add one table-driven `it.each` with the dialect passed via the new option. Each row must fail on the pre-change code:
- mysql `SELECT * FROM orders WHERE status = "agency_id"` → `["MISSING_TENANT_PREDICATE"]`
- mysql `SELECT * FROM orders WHERE status = 'it\'s agency_id'` → `["MISSING_TENANT_PREDICATE"]`
- mysql `SELECT * FROM orders # agency_id` + newline + `WHERE status = 'paid'` → `["MISSING_TENANT_PREDICATE"]`
- postgres `SELECT * FROM orders WHERE status = E'it\'s agency_id'` → `["MISSING_TENANT_PREDICATE"]`
- `SELECT * FROM orders WHERE owner_ref IN (:TENANT_AGENCY_IDS)` (no dialect) → `["MISSING_TENANT_PREDICATE"]`

Add controls that must still pass: mysql `` WHERE `agency_id` = '42' `` → `[]`, and sqlserver `WHERE [agency_id] = '42'` → `[]`.

Pipeline regression, one test in `ask.test.ts`: the multi-tenant fixture with `enforcement: "strict"`, `dialect: "mysql"`, and a mocked model returning `SELECT * FROM orders WHERE status = "agency_id"` → rejects with `TenantGuardrailError`. This proves `ask()` threads the dialect, which the unit test can't. Placeholder casing: one `tenant-placeholders.test.ts` case, where `resolveTenantSql` with `:TENANT_AGENCY_IDS` throws `UNRESOLVED_TENANT_PLACEHOLDER` in both modes.

**Verify**: `pnpm --filter @askdb/core test` → all pass. Temporarily revert Step 3's `ask.ts` change and confirm the `ask.test.ts` regression fails, then restore it.

### Step 6: Docs, changeset, release checks

- `docs/contracts/tenant-policy.md` "Guardrail validation": pattern matching uses the target dialect's lexer (MySQL `"…"` and backslash strings, `#` comments; Postgres `E'…'`). Without a dialect it uses the generic reading. A placeholder counts only in its exact lowercase form.
- `apps/docs-site/src/content/docs/reference/core-api.mdx`: `validateTenantGuardrails(sql, policy, scope, options?)` with `options.dialect`. Check whether the function is documented there first; if it isn't, add one line near `validateSensitiveReferences` and don't invent other details.
- `.changeset/tenant-guardrail-dialect-lexer.md`: `"@askdb/core": patch`. Describe the two MySQL fail-opens, the uppercase-placeholder fail-closed, and the new optional `dialect` option.

**Verify**: `pnpm changeset status` → no major bumps. `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

Covered in Step 5. The primary owner for "which regions count as code" is `tenant-guardrail.test.ts`. `ask.test.ts` owns only "the dialect reaches the guardrail". `tenant-placeholders.test.ts` owns the casing fail-closed. Don't duplicate lexer cases already owned by `lexer.test.ts`. Test the guardrail's verdicts, not the tokens.

## Docs impact

`docs/contracts/tenant-policy.md` (Guardrail validation section) and `apps/docs-site/src/content/docs/reference/core-api.mdx` (signature). `guides/multi-tenancy.mdx` and `concepts/safety-boundaries.mdx` stay correct ("text inside string literals and comments doesn't count"). Re-read them and leave them unless they contradict.

## Done criteria

- [ ] `git grep -n 'function normalizeSql' -- packages/core/src/sql/tenant-guardrail.ts` → no match
- [ ] `git grep -n 'tenant_${' -- packages/core/src/sql/tenant-guardrail.ts packages/core/src/sql/tenant-prompt.ts` → no match
- [ ] `git grep -n 'lexSql' -- packages/core/src/sql/tenant-guardrail.ts` → match
- [ ] The Step 5 rows exist and failed before the change (state in the PR which ones you watched fail)
- [ ] The two "known limitation" tests are unchanged
- [ ] `git diff --name-only -- packages/core/src/sql/lexer.ts packages/core/src/sql/bind.ts` → empty
- [ ] Full gate and release checks exit 0; no major bumps

## STOP conditions

- Readiness check fails.
- An existing dialect-less guardrail test changes verdict under `GENERIC_LEXER`. The generic profile then differs from `normalizeSql` in a way this plan didn't anticipate, so report the case.
- The lexer mis-lexes something the guardrail needs (you'd have to change `lexer.ts`).
- Step 4's casing check fires in an existing test that represents a legitimate query.

## Maintenance notes

- After this plan, "what is code" has one definition (`lexer.ts`) and "what a tenant placeholder is called" has one (`placeholderForRoot`). Future tenant code must use both, and not introduce another regex.
- Plan 050 (clause-aware checks or rewriting) should build on `codeView`'s token stream, or on the sensitive guardrail's scope resolver, rather than on the lowercased text.
- Reviewer focus: the no-dialect path must behave exactly as before (the existing tests prove it), and `ask()` and `generate.ts` must both pass the dialect.
