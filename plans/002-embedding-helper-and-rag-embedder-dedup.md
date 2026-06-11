# Plan 002: Deduplicate embedding-middleware wrappers and deprecate the RAG OpenAI bypass

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 154b17e..HEAD -- packages/ai/src packages/ai-openai/src packages/ai-azure/src packages/rag/src/embedders packages/rag/README.md docs/integration/rag-recipes.md`
> Plan 001 intentionally changes some of these files — compare against the
> post-001 state described below. If plan 001 has NOT been merged, this plan's
> premise is wrong: STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-ai-adapter-contract-v2.md
- **Category**: tech-debt
- **Planned at**: commit `154b17e`, 2026-06-11

## Why this matters

Two small duplications undercut the adapter architecture. First, `@askdb/ai-openai` and `@askdb/ai-azure` each contain a private, near-identical ~20-line block that wraps an embedding model with `defaultEmbeddingSettingsMiddleware` to forward `dimensions`/`user` — the only difference is the provider key in the options object (`openai` vs `azure`). Every future adapter would copy it again. Second, `@askdb/rag` ships `createOpenAiEmbedder`, which dynamic-imports `@ai-sdk/openai` directly — a second, competing pattern for "construct an OpenAI embedding model" that bypasses the `@askdb/ai` registry and its env-var conventions. Consolidating the wrapper into `@askdb/ai` and steering users to the generic `createAiSdkEmbedder` (BYO model) or the registry path keeps one way to do each thing.

## Current state

(Verified at `154b17e`; plan 001 does not change these specific blocks except as noted.)

- `packages/ai-openai/src/index.ts:14-38` — `createEmbeddingModel` builds the model, then:

```ts
const providerOptions = openAiProviderOptions(options);
if (!providerOptions) return model;
return wrapEmbeddingModel({
  model,
  middleware: defaultEmbeddingSettingsMiddleware({ settings: { providerOptions } }),
});
// ...
function openAiProviderOptions(options: CreateEmbeddingModelOptions):
  { openai: { dimensions?: number; user?: string } } | undefined {
  const openai: { dimensions?: number; user?: string } = {};
  if (options.dimensions !== undefined) openai.dimensions = options.dimensions;
  if (options.user !== undefined) openai.user = options.user;
  return Object.keys(openai).length > 0 ? { openai } : undefined;
}
```

- `packages/ai-azure/src/index.ts:24-42` — byte-for-byte the same logic with key `azure` (`azureProviderOptions`).
- `packages/ai-google/src/index.ts` — no wrapper (Google adapter forwards no embedding options). Leave it alone.
- `packages/rag/src/embedders/openai.ts` — `createOpenAiEmbedder(options)`: lazy-imports `@ai-sdk/openai`, builds `provider.embedding(model)`, delegates to `createAiSdkEmbedder`. Exported from `packages/rag/src/index.ts:70` and documented in `packages/rag/README.md:86,104` and `docs/integration/rag-recipes.md:107-109`.
- `packages/rag/src/cli.ts:14,189,245` — the RAG CLI has its own internal wrapper (`createOpenAiEmbedder` local function at 245) that calls the embedder; this is an internal product-surface usage and stays.
- `packages/rag/package.json` — `ai`, `@ai-sdk/openai`, `pg` are peers already marked optional via `peerDependenciesMeta`. **No dependency change is needed**; the cleanup is API-surface guidance, not packaging.
- Exemplar tests: `packages/ai-openai/src/index.test.ts` (mocks `ai` and `@ai-sdk/openai` via `vi.hoisted`/`vi.mock`); `packages/rag/src/embedders/ai-sdk.test.ts`.

Post-001 context the executor needs: `@askdb/ai` declares `ai` as a peer dependency (with `ai` in devDependencies), so `@askdb/ai` may import `wrapEmbeddingModel`/`defaultEmbeddingSettingsMiddleware` from `ai` at runtime; adapters import value exports from `@askdb/ai` (e.g. `resolveBaseConfig`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Test affected | `pnpm --filter @askdb/ai --filter @askdb/ai-openai --filter @askdb/ai-azure --filter @askdb/rag test` | all pass |
| Full test | `pnpm test` | exit 0 |

## Scope

**In scope**:

- `packages/ai/src/embedding.ts` (create), `packages/ai/src/index.ts`, new test `packages/ai/src/embedding.test.ts`
- `packages/ai-openai/src/index.ts`, `packages/ai-azure/src/index.ts` (+ their tests if expectations change)
- `packages/rag/src/embedders/openai.ts` (JSDoc only), `packages/rag/README.md`, `docs/integration/rag-recipes.md`
- `.changeset/<new-file>.md` (create)

**Out of scope**:

- `packages/rag/src/cli.ts` — internal CLI wiring; keep using the deprecated helper.
- `packages/rag/package.json` — peers are already correct.
- Deleting `createOpenAiEmbedder` — deprecation only; removal is a 1.0 decision.
- `packages/ai-google` — nothing to dedupe.

## Git workflow

- Branch: `advisor/002-embedding-helper-dedup`.
- Conventional commits (e.g. `refactor(ai): share embedding provider-options wrapper across adapters`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the shared wrapper to `@askdb/ai`

Create `packages/ai/src/embedding.ts`:

```ts
import type { EmbeddingModel } from "ai";
import { defaultEmbeddingSettingsMiddleware, wrapEmbeddingModel } from "ai";
import type { CreateEmbeddingModelOptions } from "./provider.js";

/**
 * Wraps an embedding model so `dimensions`/`user` are forwarded as
 * provider options under `providerKey`. Returns the model unchanged when
 * no options are set.
 */
export function withEmbeddingProviderOptions(
  model: EmbeddingModel,
  providerKey: string,
  options: CreateEmbeddingModelOptions = {},
): EmbeddingModel {
  const settings: { dimensions?: number; user?: string } = {};
  if (options.dimensions !== undefined) settings.dimensions = options.dimensions;
  if (options.user !== undefined) settings.user = options.user;
  if (Object.keys(settings).length === 0) return model;
  return wrapEmbeddingModel({
    model,
    middleware: defaultEmbeddingSettingsMiddleware({
      settings: { providerOptions: { [providerKey]: settings } },
    }),
  });
}
```

Export it from `packages/ai/src/index.ts`. Add `packages/ai/src/embedding.test.ts` (mock `ai` like `packages/ai-openai/src/index.test.ts` does): no options → same model instance returned; with `dimensions`/`user` → wrapped with `providerOptions: { myKey: { dimensions: 512, user: "u" } }`.

**Verify**: `pnpm --filter @askdb/ai test` → all pass (including the 2+ new tests).

### Step 2: Use it in the OpenAI and Azure adapters

In both `packages/ai-openai/src/index.ts` and `packages/ai-azure/src/index.ts`, replace the tail of `createEmbeddingModel` with `return withEmbeddingProviderOptions(model, "openai", options);` (key `"azure"` for azure) and delete the local `openAiProviderOptions`/`azureProviderOptions` functions and the now-unused `ai` imports. Existing test expectations (wrapped shape with the provider-keyed options) should still hold because the produced structure is identical; update mocks only if the `ai` import moving into `@askdb/ai` breaks interception — see STOP conditions.

**Verify**: `pnpm --filter @askdb/ai-openai --filter @askdb/ai-azure test` → all pass; `grep -rn "wrapEmbeddingModel" packages/ai-openai/src packages/ai-azure/src` → no matches.

### Step 3: Deprecate `createOpenAiEmbedder` and align docs

- `packages/rag/src/embedders/openai.ts`: add to the existing JSDoc of `createOpenAiEmbedder`:

```
@deprecated Construct the model yourself and use `createAiSdkEmbedder`, or use the
`@askdb/ai` registry (`createAiRegistry([openaiProvider]).createEmbeddingModelFromEnv(env)`)
so env-var conventions stay consistent. This helper will be removed in 1.0.
```

- `packages/rag/README.md` (rows/snippets at lines 86 and 104): mark the helper deprecated and show the `createAiSdkEmbedder` + `@askdb/ai-openai` path as the recommended pattern.
- `docs/integration/rag-recipes.md:107-109`: replace the `createOpenAiEmbedder` recipe with the registry/`createAiSdkEmbedder` equivalent (keep one short "deprecated helper" note so existing users can find it).

**Verify**: `pnpm lint` → exit 0; `grep -rn "deprecated" packages/rag/src/embedders/openai.ts` → 1+ match.

### Step 4: Changeset and full gate

Create `.changeset/shared-embedding-wrapper.md`: patch bumps for `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/rag`; minor for `@askdb/ai` (new export). Note the deprecation in the body.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- `packages/ai/src/embedding.test.ts` (new): pass-through case, wrapped case with both options, wrapped case with only `dimensions`. Model after `packages/ai-openai/src/index.test.ts`'s mocking style.
- Existing adapter tests keep passing unchanged (they assert the wrapped output shape, which is preserved).
- Verification: `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `grep -rn "ProviderOptions(" packages/ai-openai/src/index.ts packages/ai-azure/src/index.ts` → no local helper functions remain
- [ ] `grep -n "withEmbeddingProviderOptions" packages/ai/src/index.ts` → exported
- [ ] `grep -n "@deprecated" packages/rag/src/embedders/openai.ts` → present
- [ ] `.changeset/shared-embedding-wrapper.md` exists
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 001 is not merged (e.g. `resolveBaseConfig` is absent from `packages/ai/src`) — this plan assumes the post-001 peer-dependency layout.
- After Step 2, adapter tests fail because `vi.mock("ai")` no longer intercepts the `wrapEmbeddingModel` call (it now happens inside `@askdb/ai`). If adjusting the test to mock `@askdb/ai`'s helper or to assert on real (unmocked) wrapper output takes more than one focused attempt, stop and report the resolution options instead of weakening assertions.
- Any need to change `packages/rag/package.json` — that signals a misunderstanding; peers are already optional.

## Maintenance notes

- New adapters that support embedding options should call `withEmbeddingProviderOptions` rather than reimplementing the middleware block (plan 004's Anthropic adapter does not need it — no embeddings).
- The deprecated `createOpenAiEmbedder` should be removed when cutting 1.0; track it in the 1.0 checklist.
- Reviewer scrutiny: confirm the wrapped-output shape is byte-identical to before (the adapter tests' deep-equal assertions are the check).
