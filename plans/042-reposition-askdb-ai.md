# Plan 042: Reposition `@askdb/ai` as reusable config→model resolution, not "AskDB's model layer"

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- README.md docs/ apps/docs-site/src/content/docs packages/ai/README.md` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 041 — soft. If 041 has landed, use the `createAiRegistry(["openai"])` string form in all new examples. If it has not, use the current `createAiRegistry([openaiProvider])` form. Check first (see Step 0) and be consistent.
- **Category**: docs
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — documentation, one README rewrite, and one small additive export.

## Why this matters

`@askdb/ai` is presented as the model layer *for AskDB*. That framing is why a real integrator did not adopt it.

Their application has more than one AI feature: NL→SQL through AskDB, and a chart-recommendation service that calls `generateObject` from `ai` directly. They needed **one** model factory shared across both, so they wrote a 41-line `AiModelFactory.ts` reimplementing what `@askdb/ai` already does. Its doc comment states the requirement plainly:

> Builds the configured language model, shared by every module that calls a model directly. Query generation and visualization planning both read from the same `ai.*` configuration, so there is one place that knows how to turn that configuration into a client the AI SDK can call.

`@askdb/ai` returns a plain AI SDK `LanguageModel`. It *is* usable for exactly this. Nothing in the docs says so, so an application with two AI features reads the choice as "run two model factories or none" and picks none.

The second half of the problem: the README's own "Use as a library" section constructs the model with `createOpenAI` from `@ai-sdk/openai` and never mentions `@askdb/ai`. The flagship documented library path routes around the package. When the headline docs bypass a convenience layer, the layer is not delivering convenience.

## Current state

### Step 0 — establish which API form to use

Run this first; every code sample in this plan depends on the answer:

```
grep -n "AiProviderSelector" packages/ai/src/provider.ts && echo "041 LANDED: use string form" || echo "041 NOT LANDED: use adapter-object form"
```

- **041 landed** → write `createAiRegistry(["openai"])`, install line `pnpm add @askdb/ai @ai-sdk/openai`.
- **041 not landed** → write `createAiRegistry([openaiProvider])` with `import { openaiProvider } from "@askdb/ai-openai";`, install line `pnpm add @askdb/ai @askdb/ai-openai`.

Use one form consistently across every file you touch.

### The README library section — `README.md:46-73`

```markdown
## Use as a library

​```bash
pnpm add @askdb/core
pnpm add @askdb/postgres
# Example provider for the code below
pnpm add ai @ai-sdk/openai
​```

`pg` is optional and only needed for live Postgres introspection through `@askdb/postgres`.

​```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import { createOpenAI } from "@ai-sdk/openai";

const schema = loadSchema("./my-app.schema");
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { sql } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: openai("gpt-4o-mini"),
  dialect: postgresDialect,
});
​```
```

This is a good example and must survive — it is the honest BYO-model path. What is missing is the second path beside it.

### The "optional" framing — `docs/integration/installable-package.md:11`

```markdown
7. [`@askdb/ai`](../../packages/ai/README.md) — optional config/env-to-model registry for AI SDK providers. Pair it with provider adapters such as `@askdb/ai-openai`.
```

"Optional … registry … pair it with adapters" describes the mechanism, not the benefit, and never mentions reuse outside AskDB.

### Other surfaces asserting the same framing

- `docs/architecture.md:197` — "*`@askdb/ai` owns provider dispatch and the universal env precedence*". Accurate, but scoped to AskDB.
- `apps/docs-site/src/content/docs/reference/packages.mdx:16` — "*AI provider adapters … plug into the surfaces shown above via `@askdb/ai`*".
- `packages/ai/README.md` — read it; it is the package's npm landing page and the highest-leverage single file in this plan.

### The capability that is undersold

`packages/ai/src/reasoning.ts` exports `resolveReasoningEffort` and `REASONING_EFFORTS`, and every adapter implements `resolveProviderOptions` to map a portable `"low" | "medium" | …` onto OpenAI `reasoningEffort`, Anthropic `thinking.budgetTokens`, and Gemini `thinkingConfig`. A host can call `registry.resolveProviderOptions(config, { reasoningEffort })` and pass the result straight to its **own** `generateText` call. This is genuinely unavailable from `ai` and is currently documented only as an AskDB internal.

### Docs conventions to match

- The docs site is hand-authored Starlight MDX under `apps/docs-site/src/content/docs/`. It does **not** mirror `docs/*.md`.
- Synced tabs use `syncKey` values established by earlier plans: `wiring` (values `Direct (Vercel AI SDK)` / `Config-driven (@askdb/ai)`), plus `ai-provider`, `engine`, and `pkg`. Reuse them verbatim — do not invent new keys. Find a live example with `grep -rn 'syncKey="wiring"' apps/docs-site/src/content/docs/`.
- `pnpm docs:build` must pass; it validates internal links.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Docs build | `pnpm docs:build` | exit 0 |
| Docs dev server | `pnpm docs:dev` | serves locally for visual check |
| Typecheck | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `packages/ai/README.md` — rewrite the positioning
- `README.md` — add the config-driven path beside the direct one
- `docs/integration/installable-package.md` — reframe entry 7; add a "share one model factory" recipe
- `docs/architecture.md` — the `@askdb/ai` boundary paragraph (line ~197)
- `apps/docs-site/src/content/docs/reference/packages.mdx` — the `@askdb/ai` caption
- One docs-site guide page covering the shared-model-factory pattern (extend the existing bring-your-own-model page if one exists — find it with `ls apps/docs-site/src/content/docs/guides/`)
- `packages/ai/src/index.ts` — export `createLanguageModelForApp` (Step 5)
- `packages/ai/src/app-model.test.ts` (create)
- `.changeset/reposition-askdb-ai.md` (create)

**Out of scope** (do NOT touch):
- The behavior of `createAiRegistry`, `resolveBaseConfig`, or any adapter. This plan adds one thin convenience wrapper and otherwise only changes words.
- Plan 041's restructuring. If 041 has not landed, document today's API — do not document an API that does not exist yet.
- The README's direct BYO-model example. It stays; a second path is added beside it.
- Deleting or rewriting `docs/architecture.md` diagrams.

## Git workflow

- Branch: `advisor/042-reposition-askdb-ai`
- Commit per surface; message style e.g. `docs(ai): position @askdb/ai as reusable model resolution`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite `packages/ai/README.md`

This is the npm landing page. Lead with the reuse benefit, not the mechanism. Structure:

1. **One-sentence positioning**, e.g.: "Turn `askdb.config.*` (or environment variables) into an AI SDK `LanguageModel` — for AskDB, and for every other model call in your application."
2. **Install** — per the Step 0 form.
3. **Quickstart** — resolve a model from config and pass it to `ask()`.
4. **"Use the same model for your own calls"** — the section that fixes the real problem. Show the resolved model going straight into a plain `generateText` call that has nothing to do with AskDB:

```ts
import { generateText } from "ai";
import { createAiRegistry } from "@askdb/ai";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";

bootstrapAskDbEnv({ cwd: process.cwd() });
const { ai: aiEnv } = getAskDbRuntimeConfig().ai;

const registry = createAiRegistry(/* see Step 0 for the argument form */);
const model = await registry.createLanguageModelFromEnv(aiEnv);

// AskDB uses this model — and so can everything else in your app.
const summary = await generateText({ model, prompt: "Summarize this report…" });
```

5. **Portable reasoning effort** — show `resolveReasoningEffort` + `registry.resolveProviderOptions(config, { reasoningEffort: "low" })` feeding the host's own `generateText`, and state plainly that this maps onto OpenAI `reasoningEffort`, Anthropic extended thinking, and Gemini `thinkingConfig` without the caller writing per-provider code.
6. **When you do not need this package** — if you construct models yourself and are happy doing so, `ask()` takes any AI SDK `LanguageModel`; `@askdb/ai` is for teams that want config-driven model selection in one place.

**Verify**: `pnpm docs:build` → exit 0 (README links are checked if referenced by the site).

### Step 2: Add the config-driven path to the root README

Keep `README.md:46-73` intact. Immediately after the existing example, add a short subsection headed something like "Or resolve the model from config" that shows `createAskDb` (or the registry) doing the same job with the model coming from `askdb.config.ts`, and one sentence noting the same resolved model can be reused for the application's other AI calls, linking to `packages/ai/README.md`.

Keep it under roughly 20 lines. The README's job is orientation.

**Verify**: `pnpm docs:build` → exit 0.

### Step 3: Reframe the integration doc

In `docs/integration/installable-package.md`, rewrite entry 7 (line 11) so it leads with the benefit:

```markdown
7. [`@askdb/ai`](../../packages/ai/README.md) — resolves `askdb.config.*` / environment
   variables into an AI SDK model. Use it for AskDB **and** for your application's other
   model calls, so provider selection and API keys live in one place.
```

Then add a recipe section, "Sharing one model factory across your app", containing the `generateText` snippet from Step 1 and a sentence naming the failure mode it prevents: two model factories reading the same configuration and drifting apart.

**Verify**: `pnpm docs:build` → exit 0.

### Step 4: Align the architecture doc and the docs-site caption

- `docs/architecture.md` line ~197: extend the `@askdb/ai` sentence with the reuse point — the registry returns a plain AI SDK model, so hosts may use it for their own calls; core remains BYO-model and never depends on `@askdb/ai`. Do not change the dependency-boundary claim, which is correct.
- `apps/docs-site/src/content/docs/reference/packages.mdx` line ~16: update the caption the same way.

**Verify**: `pnpm docs:build` → exit 0.

### Step 5: Add a one-call convenience wrapper

The snippet in Step 1 is four lines of ceremony (`bootstrapAskDbEnv`, `getAskDbRuntimeConfig`, `createAiRegistry`, `createLanguageModelFromEnv`) for the most common request. Add a wrapper to `packages/ai` so the documented happy path is one call:

```ts
/**
 * Resolves the configured language model for general application use.
 *
 * Same resolution AskDB itself uses — `askdb.config.*` and the `ASKDB_AI_*` /
 * provider-native environment variables — returning a plain AI SDK
 * `LanguageModel`. Use it anywhere in your application, not only with `ask()`,
 * so provider selection and credentials live in one place.
 *
 * Returns `undefined` when no API key is configured, matching
 * `createLanguageModelFromEnv`, so AI features can stay optional.
 */
export async function createLanguageModelForApp(
  env: AiEnv,
  options?: { providers?: AiProviderAdapters; modelDefault?: string },
): Promise<LanguageModel | undefined>;
```

Implement it as a thin call through `createAiRegistry(...).createLanguageModelFromEnv(env, …)`. Do not add config loading inside `@askdb/ai` — the caller passes `getAskDbRuntimeConfig().ai.aiEnv`, preserving the existing rule (documented at `packages/ai/src/provider.ts:82-85`) that only `@askdb/config` reads `process.env`.

Export it from `packages/ai/src/index.ts` and use it in the Step 1 and Step 3 snippets.

**Verify**:
```
pnpm --filter @askdb/ai lint && pnpm --filter @askdb/ai test
pnpm --filter @askdb/ai build
node --input-type=module -e "import('./packages/ai/dist/index.js').then(m=>{ if(typeof m.createLanguageModelForApp!=='function') throw new Error('missing'); console.log('OK'); })"
```
→ `OK`.

### Step 6: Docs-site guide page, changeset, and full gate

Add the shared-model-factory pattern to the docs site. Prefer extending the existing bring-your-own-model guide over creating a new page — find it with `ls apps/docs-site/src/content/docs/guides/`. Use the existing `syncKey="wiring"` tabs so the direct and config-driven paths sit side by side exactly as they do elsewhere on the site.

If plan 041 has landed, also document the bundler caveat in one short note: provider SDKs are loaded with dynamic `import()`, which can produce unresolved-module warnings in Vite/webpack builds when a provider is not installed; passing an explicit adapter object is the bundler-safe alternative.

Create `.changeset/reposition-askdb-ai.md` — **minor** for `@askdb/ai` (the new export). Body: `createLanguageModelForApp` is added; `@askdb/ai` is documented as reusable beyond AskDB.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- `packages/ai/src/app-model.test.ts`: `createLanguageModelForApp` returns `undefined` when the env has no API key; returns a model when it does; honors an explicit `providers` argument. Model it on the existing `packages/ai/src/provider.test.ts`, which already builds fake adapters and plain env objects — reuse that fixture style rather than hitting a network.
- **Every code snippet added by this plan must be verified to compile**, not just eyeballed. For each one, paste it into a scratch `.ts` file inside `examples/ask-question/`, run `pnpm --filter askdb-example-ask-question exec tsc --noEmit` (confirm the package name from its `package.json`), then delete the scratch file. Documentation snippets that do not compile are the most common defect in docs changes.
- `pnpm docs:build` validates internal links across the site.

## Done criteria

ALL must hold:

- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build` all exit 0
- [ ] `packages/ai/README.md` contains a section showing the resolved model passed to a plain `generateText` call that does not involve `ask()`
- [ ] `grep -n "optional config/env-to-model registry" docs/integration/installable-package.md` returns no matches (old framing gone)
- [ ] `README.md` shows both the direct AI SDK path and the config-driven path
- [ ] `createLanguageModelForApp` is exported from `@askdb/ai` and covered by tests
- [ ] Every new code snippet was compile-checked per the test plan
- [ ] All new tabs reuse an existing `syncKey`; `grep -rn 'syncKey=' apps/docs-site/src/content/docs/ | grep -v -E 'wiring|ai-provider|engine|pkg'` returns no matches
- [ ] `.changeset/reposition-askdb-ai.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 0's grep is ambiguous, or the repo is mid-migration on plan 041 (some surfaces on the string form, some on adapter objects). Documenting a half-migrated API is worse than waiting — report and stop.
- A code snippet you wrote does not compile and the fix requires changing `@askdb/ai`'s API beyond the Step 5 wrapper.
- You conclude `@askdb/ai` should load config itself (calling `getAskDbRuntimeConfig` internally). That would break the documented rule at `packages/ai/src/provider.ts:82-85` that only `@askdb/config` reads `process.env`, and would create a dependency cycle. Report the argument instead.
- `pnpm docs:build` fails on a broken link you cannot resolve from the surrounding content.

## Maintenance notes

- **The positioning is the deliverable.** If a future change makes `@askdb/ai` AskDB-specific again — for example by returning a wrapped model instead of a plain AI SDK `LanguageModel` — this plan's premise breaks. Returning the plain SDK type is load-bearing; keep it.
- Any new provider added after this lands needs its reasoning-effort mapping mentioned in the `packages/ai/README.md` portable-effort section, or that section quietly becomes wrong.
- **Reviewer focus**: confirm every snippet was compile-checked, and that the README's original direct BYO-model example still exists unchanged — the point is to add a path, not replace one.
