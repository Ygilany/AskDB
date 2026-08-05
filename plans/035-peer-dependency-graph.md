# Plan 035: Make `ai` and the provider SDKs peer dependencies so consumers own their AI SDK version

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/core/package.json packages/client/package.json packages/ai-openai/package.json packages/ai-azure/package.json packages/ai-google/package.json packages/ai-anthropic/package.json` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (pairs well with plan 034, but neither blocks the other)
- **Category**: tech-debt
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: **Yes, at install time.** Consumers who relied on `ai` arriving transitively via `@askdb/core` must add it to their own `package.json`. Everything in this repo is pre-1.0 beta, so this is the right moment.
- **Supersedes a prior decision**: ADR 0006 (Accepted, 2026-06-11) states *"Retain `ai` as a runtime dependency while core calls `generateText`"*, and `plans/README.md` records "do not re-audit" against this exact item. This plan deliberately reverses that, on evidence that did not exist when the ADR was written (see "Why this matters"). Step 0 amends the ADR; do not skip it.

## Why this matters

`@askdb/core`'s entire design premise is bring-your-own-model: `ask()` takes an AI SDK `LanguageModel` that the caller constructs. Yet core declares `ai` as a hard **dependency**, so it bundles and pins its own copy.

The consequence is not theoretical. A real consumer integration runs `ai@^6.0.235` with `@ai-sdk/openai@^3`, and is pinned to `@askdb/core@^1.0.0-beta.40` because `beta.41` moved core to `ai@^7`. Upgrading AskDB now forces them to migrate their entire application's AI stack in the same change — including AI features that have nothing to do with AskDB. Worse, if they did install both, they would get two copies of `ai` in the tree, and the `LanguageModel` they construct would carry a different specification version than the `generateText` core calls internally.

The same mistake repeats one level down: each `@askdb/ai-*` adapter hard-depends on its `@ai-sdk/*` provider package, so a consumer who already uses `@ai-sdk/openai` gets a second nested copy at a different major.

Making these peers hands version control back to the consumer, which is where it belongs for a BYO-model library.

## Current state

### `packages/core/package.json`

```json
  "dependencies": {
    "ai": "^7.0.51",
    "gray-matter": "^4.0.3",
    "pino": "^10.3.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
```

There is no `peerDependencies` block at all.

### What core actually uses from `ai`

The surface is tiny. All non-test usages at `cc1193a`:

- `packages/core/src/ask.ts:1` — `import type { generateText as defaultGenerateText } from "ai";` (type only)
- `packages/core/src/ai/types.ts:1` — `export type { LanguageModel as AskDbLanguageModel } from "ai";` (type only)
- `packages/core/src/enrichment/suggest.ts:1-2` — `import type { LanguageModel }` + `import { generateText as defaultGenerateText }`
- `packages/core/src/sql/generate.ts:1` — `import { generateText as defaultGenerateText } from "ai";`

So exactly one runtime import (`generateText`) at two call sites, plus types.

### Why the range cannot simply be widened to `^6 || ^7`

AI SDK 7 renamed `generateText`'s `system` option to `instructions`. Commit `0c62b25` made that change in `packages/core/src/sql/generate.ts`:

```
-        system: buildNlToSqlSystemPrompt(dialect),
+        instructions: buildNlToSqlSystemPrompt(dialect),
```

and `.changeset/ai-sdk-7-upgrade.md` states it explicitly: *"Core model calls now use the AI SDK 7 `instructions` option."* A single call shape therefore does not work across both majors without a compatibility measure. Step 5 investigates one; it is explicitly optional and gated.

The current call site, `packages/core/src/sql/generate.ts:95-116`:

```ts
      const result = await generateText({
        model,
        instructions: buildNlToSqlSystemPrompt(dialect),
        prompt: buildNlToSqlUserPrompt(/* … */),
        temperature: 0,
        ...(deps.providerOptions
          ? { providerOptions: deps.providerOptions as Parameters<typeof generateText>[0]["providerOptions"] }
          : {}),
      });
```

Note that the usage-reading code immediately below (lines 118-136) *already* handles both naming conventions (`promptTokens ?? inputTokens`), so response parsing is already cross-major tolerant. Only the request shape is not.

### The other three misdeclarations

`packages/client/package.json` — `@askdb/ai` is a hard dependency even though the BYO-model path never needs it:

```json
  "peerDependencies": {
    "@askdb/config": "workspace:^",
    "@askdb/core": "workspace:^",
    "ai": "^7.0.51"
  },
  "dependencies": {
    "@askdb/ai": "workspace:^"
  }
```

`packages/ai-openai/package.json` (and identically `ai-azure`, `ai-google`, `ai-anthropic`) — the provider SDK is a hard dependency:

```json
  "dependencies": {
    "@ai-sdk/openai": "^4.0.29"
  },
  "peerDependencies": {
    "@askdb/ai": "workspace:^",
    "ai": "^7.0.51"
  },
```

### The correct reference pattern, already in this repo

`packages/rag/package.json` gets this right — optional peers with dev deps for local building:

```json
  "peerDependencies": {
    "@ai-sdk/openai": "^4.0.29",
    "ai": "^7.0.51",
    "pg": ">=8"
  },
  "peerDependenciesMeta": {
    "@ai-sdk/openai": { "optional": true },
    "ai": { "optional": true },
    "pg": { "optional": true }
  },
  "devDependencies": {
    "@ai-sdk/openai": "^4.0.29",
    "ai": "^7.0.51",
    ...
  }
```

Match this shape. Note the rule: **anything moved out of `dependencies` into `peerDependencies` must also be added to `devDependencies`**, or the workspace build breaks.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build all | `pnpm build` | exit 0 |
| Typecheck | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Install smoke | `pnpm smoke:install` | exit 0 |
| Inspect a manifest | `node -e "const j=require('./packages/core/package.json'); console.log(JSON.stringify({d:j.dependencies,p:j.peerDependencies},null,2))"` | prints the blocks |

## Scope

**In scope**:
- `docs/adrs/0006-ai-provider-integration-strategy.md` — amendment only (Step 0)
- `packages/core/package.json`
- `packages/client/package.json`
- `packages/ai-openai/package.json`, `packages/ai-azure/package.json`, `packages/ai-google/package.json`, `packages/ai-anthropic/package.json`
- `packages/client/src/client.ts` (only if Step 4 requires a type-only import change)
- `.changeset/ai-peer-dependencies.md` (create)
- `docs/architecture.md` — the install-profiles table (see Step 6)

**Out of scope** (do NOT touch):
- `packages/core/src/**` except as explicitly authorized in the optional Step 5. This plan is a manifest change; resist the urge to refactor call sites.
- `packages/rag/package.json` — already correct; leave it alone.
- `apps/**` — applications legitimately hard-depend on `ai`; that is what an application is for.
- Plan 041 restructures the four `@askdb/ai-*` packages entirely. Here you only move one line in each manifest. Do not start merging them.

## Git workflow

- Branch: `advisor/035-peer-dependency-graph`
- Commit per step; message style e.g. `fix(core): declare ai as a peer dependency`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Amend ADR 0006 before changing any manifest

`docs/adrs/0006-ai-provider-integration-strategy.md` is **Accepted** and its decision section states at line 171:

```
- Retain `ai` as a runtime dependency while core calls `generateText`.
```

This plan reverses that. Silently contradicting an accepted ADR is worse than the original problem, so record the change first.

Add an **Amendment** section at the end of that ADR (do not rewrite the original decision — ADRs are an append-only record). Read `docs/adrs/0005-askdb-config-and-env-bootstrap.md` first to see whether this repo has an established amendment format, and match it if so. The amendment must state:

- Date and that it amends the 2026-06-11 decision.
- What changes: `ai` moves from a runtime dependency of `@askdb/core` to a required peer dependency.
- Why the original reasoning no longer holds: retaining `ai` as a dependency was justified by core calling `generateText`, but calling a package is not a reason to *pin* it. Because `ask()` accepts a caller-constructed `LanguageModel`, the caller and core must agree on one `ai` instance — a hard dependency actively prevents that agreement across majors.
- The concrete evidence: an integration on `ai@6` is pinned to `@askdb/core@beta.40` because `beta.41` moved core to `ai@7`, which would force an unrelated migration of their whole AI stack.
- What is unchanged: core stays BYO-model, still exports `AskDbLanguageModel`, and still calls `generateText`.

**Verify**: `grep -n "Amendment" docs/adrs/0006-ai-provider-integration-strategy.md` → returns a match. `pnpm docs:build` → exit 0.

### Step 1: Move `ai` to a peer dependency of `@askdb/core`

In `packages/core/package.json`, remove `"ai": "^7.0.51"` from `dependencies`, add a `peerDependencies` block, and add `ai` to `devDependencies`. Keep the manifest's existing key order (dependencies, peerDependencies, devDependencies):

```json
  "dependencies": {
    "gray-matter": "^4.0.3",
    "pino": "^10.3.1",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "ai": "^7.0.51"
  },
  "devDependencies": {
    "ai": "^7.0.51",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
```

Do **not** mark it optional. Core cannot generate SQL without it; a missing required peer should warn loudly at install time.

**Verify**:
```
pnpm install
pnpm --filter @askdb/core build && pnpm --filter @askdb/core test
node -e "const j=require('./packages/core/package.json'); if(j.dependencies.ai) throw new Error('still a dependency'); if(!j.peerDependencies.ai) throw new Error('peer missing'); console.log('core peer OK')"
```
→ `core peer OK`, build and tests pass.

### Step 2: Make `@askdb/ai` an optional peer of `@askdb/client`

`@askdb/client` needs `@askdb/ai` only when the caller passes `providers` or `registry`. Callers who pass a `model` override never touch it.

In `packages/client/package.json`, delete the `dependencies` block entirely and extend the peers:

```json
  "peerDependencies": {
    "@askdb/ai": "workspace:^",
    "@askdb/config": "workspace:^",
    "@askdb/core": "workspace:^",
    "ai": "^7.0.51"
  },
  "peerDependenciesMeta": {
    "@askdb/ai": { "optional": true }
  },
  "devDependencies": {
    "@askdb/ai": "workspace:*",
    "@askdb/config": "workspace:*",
    "@askdb/core": "workspace:*",
    "ai": "^7.0.51",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
```

**Verify**:
```
pnpm install
pnpm --filter @askdb/client build && pnpm --filter @askdb/client test
```
→ exit 0, all pass.

Note: `packages/client/src/client.ts:1-8` imports `createAiRegistry` (a value) from `@askdb/ai`. A static value import from an optional peer means the module fails to load when the peer is absent. If you want that to be genuinely optional, it needs a dynamic import — **that is out of scope here**; plan 041 restructures this area. For now the optional marker documents intent and stops npm from installing it unasked. If the build fails because of this, record it and move on to Step 3; do not refactor `client.ts`.

### Step 3: Make each `@ai-sdk/*` a peer of its adapter

For each of `packages/ai-openai`, `packages/ai-azure`, `packages/ai-google`, `packages/ai-anthropic`: move the single `@ai-sdk/*` entry out of `dependencies` into `peerDependencies` and add it to `devDependencies`. Delete the now-empty `dependencies` block.

`packages/ai-openai/package.json` becomes:

```json
  "peerDependencies": {
    "@ai-sdk/openai": "^4.0.29",
    "@askdb/ai": "workspace:^",
    "ai": "^7.0.51"
  },
  "devDependencies": {
    "@ai-sdk/openai": "^4.0.29",
    "@askdb/ai": "workspace:*",
    "ai": "^7.0.51",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
```

Apply the same shape with `@ai-sdk/azure` `^4.0.30`, `@ai-sdk/google` `^4.0.33`, `@ai-sdk/anthropic` `^4.0.29` respectively. Keep each package's existing version specifier — do not bump anything.

**Verify**:
```
pnpm install && pnpm build && pnpm test
node -e "
const fs=require('fs');
for (const p of ['ai-openai','ai-azure','ai-google','ai-anthropic']) {
  const j=JSON.parse(fs.readFileSync('packages/'+p+'/package.json','utf8'));
  const sdk=Object.keys(j.peerDependencies||{}).find(k=>k.startsWith('@ai-sdk/'));
  if(!sdk) throw new Error(p+': no @ai-sdk peer');
  if(j.dependencies && Object.keys(j.dependencies).length) throw new Error(p+': dependencies not empty');
  if(!(j.devDependencies||{})[sdk]) throw new Error(p+': '+sdk+' missing from devDependencies');
}
console.log('adapter peers OK');
"
```
→ `adapter peers OK`, build and tests pass.

### Step 4: Confirm the apps still install everything they need

The three surfaces (`apps/cli`, `apps/http-api`, `apps/studio`) already declare `ai` and the adapter packages directly. Now that the adapters no longer pull `@ai-sdk/*` transitively, each app must declare those itself.

Check each app's manifest and add any `@ai-sdk/*` package it now lacks, at the versions from Step 3. Applications are the correct place for hard dependencies.

**Verify**:
```
pnpm install
pnpm build
node -e "require('./apps/cli/package.json')" 
pnpm exec askdb ask --schema fixtures/schemas/orders-users.schema --question 'How many orders are there?' 2>&1 | head -5
```
→ build exits 0. The `askdb ask` call may fail for lack of an API key — that is fine and expected. It must NOT fail with a module-resolution error such as `Cannot find package '@ai-sdk/openai'`. If it does, an app manifest is still missing a dependency.

### Step 5 (OPTIONAL — gated experiment): try widening core's `ai` range to `^6 || ^7`

Attempt this only after Steps 1–4 are green and committed. If it does not work cleanly, ship `^7` and report — that is a perfectly good outcome and the bulk of this plan's value is already banked.

The single blocker is the `system` → `instructions` rename described in "Current state". The candidate shim is to send both keys, since each major reads only the one it knows:

```ts
        // AI SDK 6 reads `system`; AI SDK 7 renamed it to `instructions`.
        // Sending both keeps one call shape valid across majors — each version
        // reads the key it knows and ignores the other.
        instructions: systemPrompt,
        system: systemPrompt,
```

Before adopting it, verify empirically that AI SDK 7 tolerates the extra `system` key rather than rejecting it:

1. Create a scratch directory **outside the repo** (e.g. `/tmp/askdb-v6-probe`) so no workspace file is touched.
2. In it, install `ai@6` in one subdirectory and `ai@7` in another.
3. In each, call `generateText` with a stub model object and both keys set, and confirm neither throws a validation error and each picks up the prompt.

If both pass, apply the shim to `packages/core/src/sql/generate.ts` and `packages/core/src/enrichment/suggest.ts`, widen core's peer range to `"ai": "^6 || ^7"`, and add a unit test asserting both keys are present on the options object passed to an injected `deps.generateText` mock.

**Verify**: `pnpm --filter @askdb/core test` → passes, including the new dual-key test. `pnpm lint` → exit 0.

### Step 6: Update the install-profile documentation and write the changeset

`docs/architecture.md` line ~331 currently tells readers that `@askdb/postgres` "pulls `@askdb/core`, `@askdb/introspect`, and `ai` as package dependencies." After Step 1 that is false. Correct that row so `ai` is listed as a required peer the consumer installs, and scan the rest of the install-profiles table for the same claim.

Create `.changeset/ai-peer-dependencies.md`: **minor** bump for `@askdb/core`, `@askdb/client`, `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`. The body must state plainly that consumers now install `ai` (and their `@ai-sdk/*` provider package) themselves, show the one-line `pnpm add ai @ai-sdk/openai` remedy, and explain the rationale: AskDB is BYO-model, so the host application owns the AI SDK version. If Step 5 landed, state the supported range.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm smoke:install` → all exit 0.

## Test plan

- **No new unit tests for Steps 1–4** — these are manifest changes; the existing suites are the regression net and must pass unchanged.
- **If Step 5 lands**: add a test in `packages/core/src/sql/generate.test.ts` asserting that the options object handed to an injected `deps.generateText` carries both `instructions` and `system` with the same value. Model it on the existing tests in that file, which already inject a `generateText` mock.
- `examples/installable-smoke` is the real gate: it installs from packed tarballs, so it exercises the published dependency graph rather than the workspace links. `pnpm smoke:install` passing is the strongest signal that the peer graph resolves for an outside consumer.

## Done criteria

ALL must hold:

- [ ] `docs/adrs/0006-ai-provider-integration-strategy.md` contains an Amendment section (Step 0)
- [ ] `pnpm install` exits 0 with no unmet-peer errors
- [ ] `pnpm build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 with no test files modified unless Step 5 landed
- [ ] `pnpm smoke:install` exits 0
- [ ] `node -e "const j=require('./packages/core/package.json'); if(j.dependencies.ai) throw 1; if(!j.peerDependencies.ai) throw 2"` exits 0
- [ ] No `@askdb/ai-*` package has a non-empty `dependencies` block
- [ ] `grep -n "and \`ai\` as package dependencies" docs/architecture.md` returns no matches
- [ ] `.changeset/ai-peer-dependencies.md` exists and lists all six packages
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm install` reports unmet peer dependencies that cannot be resolved by adding the package to `devDependencies` of the workspace package that needs it.
- Making `@askdb/ai` an optional peer of `@askdb/client` breaks the client build because of the static value import at `packages/client/src/client.ts:1-8`. Record the failure and continue to Step 3 — do not refactor `client.ts` to a dynamic import; that belongs to plan 041.
- In Step 5, AI SDK 7 rejects the extra `system` key, or AI SDK 6 rejects `instructions`. Abandon Step 5, keep the range at `^7`, and report the exact error. Do not attempt runtime version sniffing of the `ai` package.
- Any app fails at runtime with `Cannot find package '@ai-sdk/...'` after Step 4 and adding the dependency to that app's manifest does not fix it.
- You find yourself editing more than the six manifests plus the two files named in Step 5.

## Maintenance notes

- **The rule going forward**: anything a consumer could reasonably already have installed — `ai`, `@ai-sdk/*`, database drivers — is a peer, never a dependency. `@askdb/rag` is the reference implementation.
- **When AI SDK 8 arrives**, this plan's structure is what makes the upgrade cheap: bump the peer range, let consumers move at their own pace. Without it, every major forces a coordinated release of every AskDB package.
- **Plan 041 supersedes part of Step 3.** It collapses the four adapter packages into `@askdb/ai` with lazy dynamic imports. The peer declarations added here carry over to the merged package; the `devDependencies` entries do too.
- **Reviewer focus**: confirm every package moved out of `dependencies` also appears in `devDependencies` (otherwise CI builds pass locally via workspace hoisting and fail on a clean install), and that `pnpm smoke:install` — not just `pnpm build` — was actually run, since only the smoke test exercises the packed dependency graph.
