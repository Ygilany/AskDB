# Plan 006: Guard known-provider config branches against the `CustomAiConfig` type hole

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d208feb..HEAD -- packages/config/src/flatten.ts packages/config/src/types.ts packages/config/src/config.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plans 001–005 are merged)
- **Category**: bug
- **Planned at**: commit `d208feb`, 2026-06-12

## Why this matters

When the custom-provider branch (`CustomAiConfig`, with `provider: string & {}`) was added
to the `AskDbAiConfig` discriminated union, it silently weakened the typing of the *known*
providers: every known literal (`"openai"`, `"google"`, …) is also assignable to
`string & {}`, so TypeScript now accepts configs that omit or mismatch the required
provider branch. Verified empirically at `d208feb` — both of these compile (`tsc` exit 0)
when they were compile errors before:

```ts
const broken: AskDbConfig["ai"] = { provider: "openai" };                 // no providerConfig at all
const alsoBroken: AskDbConfig["ai"] = {
  provider: "google",
  providerConfig: { custom: { apiKey: "k" } },                            // wrong branch shape
};
```

At runtime, `flattenAskDbConfig` then dereferences the missing branch
(`(config.ai as OpenaiAiConfig).providerConfig.openai` → `providerConfig` is `undefined`)
and the user's `askdb.config.*` bootstrap dies with a raw
`TypeError: Cannot read properties of undefined` instead of either a compile error or a
clear message. This is a misconfiguration-path bug, not a correct-config bug — but config
bootstrap is the first thing every new user touches, and an opaque TypeError there is the
worst possible first impression.

TypeScript cannot express "any string *except* these literals", so the compile-time hole
cannot be closed without hurting legitimate usage (see "Rejected approaches" below). The
fix is runtime guards with clear, actionable error messages in each known-provider branch.

## Current state

All at commit `d208feb`.

- `packages/config/src/types.ts` — `AskDbAiConfig` union (lines ~119–127): five known
  branches (`OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`,
  `GoogleAiConfig`, each with a **required** `providerConfig` containing its required
  branch key) plus `CustomAiConfig` (lines ~110–117):

```ts
export type CustomAiConfig = {
  provider: string & {};
  providerConfig?: { custom?: CustomProviderConfig };
};
```

- `packages/config/src/flatten.ts` — the AI section of `flattenAskDbConfig`
  (starting at the `// --- AI ---` comment, ~line 72). Each known branch casts and
  dereferences without a guard:

```ts
  // Use type assertions in each branch because the inclusion of CustomAiConfig (provider: string & {})
  // in the union prevents TypeScript from narrowing providerConfig to the specific branch shape —
  // the runtime guard on `provider` still ensures correctness.
  if (config.ai.provider === "openai") {
    set(out, "ASKDB_AI_PROVIDER", "openai");
    applyOpenAiAi(out, (config.ai as OpenaiAiConfig).providerConfig.openai);
  } else if (config.ai.provider === "azure") {
    set(out, "ASKDB_AI_PROVIDER", "azure");
    applyAzureLikeAi(out, (config.ai as AzureAiConfig).providerConfig.azure);
  } else if (config.ai.provider === "foundry") {
    // `@askdb/core` treats `foundry` like Azure for env parsing.
    set(out, "ASKDB_AI_PROVIDER", "foundry");
    applyAzureLikeAi(out, (config.ai as FoundryAiConfig).providerConfig.foundry);
  } else if (config.ai.provider === "google") {
    set(out, "ASKDB_AI_PROVIDER", "google");
    applyGoogleAi(out, (config.ai as GoogleAiConfig).providerConfig.google);
  } else if (config.ai.provider === "anthropic") {
    set(out, "ASKDB_AI_PROVIDER", "anthropic");
    applyAnthropicAi(out, (config.ai as AnthropicAiConfig).providerConfig.anthropic);
  } else {
    // Custom/third-party provider: flatten to the universal ASKDB_AI_* keys ...
    set(out, "ASKDB_AI_PROVIDER", config.ai.provider);
    const custom = (config.ai as CustomAiConfig).providerConfig?.custom;
    set(out, "ASKDB_AI_API_KEY", custom?.apiKey);
    set(out, "ASKDB_AI_BASE_URL", custom?.baseUrl);
    set(out, "ASKDB_AI_MODEL", custom?.model);
  }
```

  (The comment's claim "the runtime guard on `provider` still ensures correctness" is the
  bug: the guard routes correctly, but nothing checks the branch payload exists.)

- `packages/config/src/config.test.ts` — the flatten tests. Relevant existing cases (~lines
  222–305): anthropic branch flattening, anthropic default model, custom provider →
  universal `ASKDB_AI_*` keys, custom provider with absent `providerConfig` (must keep
  working — that is legitimate when the key comes from `.env`), known providers unaffected
  by the custom branch. Error-style precedent in the same file/codebase: flatten already
  throws `askdb.config: …`-prefixed messages, e.g.
  `askdb.config: rag.embedderConfig.openai is required for embedder "openai".` — match
  that exact style.

- Repo conventions: strict tsc as lint, vitest (`pnpm --filter @askdb/config test`),
  conventional commits, changesets authored by hand in `.changeset/` (see
  `.changeset/add-anthropic-provider.md` if still present, or any file there, for format).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Config tests | `pnpm --filter @askdb/config test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `packages/config/src/flatten.ts`
- `packages/config/src/types.ts` (JSDoc only — document the hole and the runtime guard)
- `packages/config/src/config.test.ts`
- `.changeset/<new-file>.md` (create)

**Out of scope** (do NOT touch):

- The `AskDbAiConfig` union shape itself — do not remove `CustomAiConfig`, do not make its
  `providerConfig` required (that breaks the legitimate "bare provider string + key from
  `.env`" flow, which has a test), and do not attempt type-level exclusion of known
  literals (not expressible in TypeScript; see Rejected approaches).
- `packages/ai/**` and the adapters — the bug is entirely in config flattening.
- The introspection/rag flatten branches — they already use optional chaining and have a
  different (engine-selection) failure mode.

## Rejected approaches (do not re-attempt)

- **Type-level fix**: `Exclude<string, "openai" | …>` does not exist in TypeScript;
  there is no way to type "any string except these literals".
- **Making `CustomAiConfig.providerConfig` required**: would restore a compile error for
  `{ provider: "openai" }`, but breaks `{ provider: "mistral" }` with the API key supplied
  via `.env` (tested, legitimate), and still doesn't catch
  `{ provider: "google", providerConfig: { custom: … } }`.
- **Template-literal branding of custom providers** (e.g. `custom:${string}`): clean types
  but a breaking, noisy authoring API for third-party providers; not worth it pre-1.0 for
  a misconfiguration path.

## Git workflow

- Branch: `advisor/006-config-known-provider-guards`.
- Conventional commit, e.g. `fix(config): clear error when a known provider's config branch is missing`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a guard helper and apply it in all five known branches

In `packages/config/src/flatten.ts`, add a small helper near the other private helpers:

```ts
function requireProviderBranch<T>(
  provider: string,
  branch: T | undefined,
): T {
  if (!branch) {
    throw new Error(
      `askdb.config: ai.providerConfig.${provider} is required when ai.provider is "${provider}". ` +
        `(Did you put the settings under providerConfig.custom? That branch is only for ` +
        `third-party providers without a first-party package.)`,
    );
  }
  return branch;
}
```

Then change each known branch to optional-chain through the guard, e.g.:

```ts
applyOpenAiAi(out, requireProviderBranch("openai", (config.ai as OpenaiAiConfig).providerConfig?.openai));
```

Apply the same pattern for `azure`, `foundry`, `google`, `anthropic` (the `foundry` branch
passes `"foundry"` as the provider name so the message names the key the user must set).
Update the misleading comment above the chain: the assertions remain, but state that the
payload presence is enforced by `requireProviderBranch` because `CustomAiConfig` makes the
union non-narrowing.

**Verify**: `pnpm --filter @askdb/config build` → exit 0 (tests updated in Step 2).

### Step 2: Tests

In `packages/config/src/config.test.ts`, following the style of the existing
anthropic/custom flatten tests (~lines 222–305), add:

1. `{ provider: "openai" }` with no `providerConfig` (cast via `as unknown as AskDbConfig["ai"]`
   only if needed — it should compile as-is; that's the hole) → `flattenAskDbConfig` throws,
   message matches `/ai\.providerConfig\.openai is required/`.
2. `{ provider: "google", providerConfig: { custom: { apiKey: "k" } } }` → throws,
   message matches `/ai\.providerConfig\.google is required/`.
3. `{ provider: "foundry", providerConfig: {} }` → throws, message names
   `ai.providerConfig.foundry`.
4. Regression: the existing tests for valid known-provider configs, the custom-provider
   universal-key flattening, and the bare custom provider (`{ provider: "bedrock" }` with
   no `providerConfig`) must all still pass **unchanged** — do not edit them.

**Verify**: `pnpm --filter @askdb/config test` → all pass, including 3 new tests.

### Step 3: Document the hole at the type

In `packages/config/src/types.ts`, extend the `CustomAiConfig` JSDoc with one paragraph:
known provider literals are technically assignable to this branch (TypeScript cannot
exclude string literals from `string`), so `flattenAskDbConfig` validates at runtime that
known providers carry their dedicated `providerConfig` branch and throws a clear
`askdb.config: …` error otherwise.

**Verify**: `pnpm --filter @askdb/config lint` → exit 0.

### Step 4: Changeset and full gate

Create `.changeset/config-known-provider-guards.md` with a **patch** bump for
`@askdb/config`: "Throw a clear `askdb.config:` error when a first-party provider
(`openai`/`azure`/`foundry`/`google`/`anthropic`) is selected without its
`providerConfig` branch, instead of crashing with a TypeError during config flattening."

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- Three new throw-path tests (Step 2) in `packages/config/src/config.test.ts`, modeled on
  the existing `flattens anthropic provider branch to correct env keys` test's structure
  and the existing throw assertions for rag misconfiguration in the same file.
- Existing valid-path and custom-provider tests pass unchanged (regression guard).
- Verification: `pnpm --filter @askdb/config test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `grep -n "requireProviderBranch" packages/config/src/flatten.ts` → helper + 5 call sites
- [ ] `grep -c "providerConfig\." packages/config/src/flatten.ts` — no known branch
      dereferences `providerConfig.<key>` without the guard (manual read of the AI section)
- [ ] New tests: `pnpm --filter @askdb/config test` output includes the 3 new throw cases
- [ ] Existing custom-provider tests unchanged (`git diff` shows no edits to them)
- [ ] `.changeset/config-known-provider-guards.md` exists with a patch bump
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The flatten AI section at `packages/config/src/flatten.ts` no longer matches the
  "Current state" excerpt (someone may have fixed or reshaped it since `d208feb`).
- Test case 1 (`{ provider: "openai" }` bare) fails to *compile* — that means the type
  hole was closed some other way; the runtime guards may be redundant, report instead.
- Fixing this appears to require changing the `AskDbAiConfig` union shape or any file in
  `packages/ai/**`.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any future first-party provider branch added to `flattenAskDbConfig` (e.g. via the
  `new-ai-adapter` skill, `.claude/skills/new-ai-adapter/SKILL.md` Step 4.3) must wrap its
  payload in `requireProviderBranch` — update that skill's config snippet if its wording
  doesn't already imply it.
- If TypeScript ever ships negated string-literal types, revisit closing the hole at the
  type level and removing the runtime guards.
- Reviewer scrutiny: the error message must name the exact `providerConfig.<key>` the user
  has to set, and the bare-custom-provider flow (`{ provider: "bedrock" }`, key from
  `.env`) must remain untouched.
