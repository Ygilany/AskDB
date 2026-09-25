# Plan 057: Send reasoning effort through AI SDK 7's native `reasoning` call option

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `plans/README.md`, unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)**: every command must print the expected result, or STOP.
>
> ```bash
> for n in 188 196 198; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done   # → MERGED ×3
> git grep -n "forceReasoning: true" -- packages/ai/src/providers/azure.ts                      # → 1 match (#188)
> git grep -n '"ai": "^6.0.0 || ^7.0.0"' -- packages/core/package.json                         # → 1 match (#196)
> test -f packages/ai/src/providers/gateway.ts && echo ok                                       # → ok (#198)
> # The problem still exists: hand-maintained budget/effort tables are live.
> git grep -n -E "THINKING_BUDGETS|ADAPTIVE_EFFORTS|GEMINI_25_THINKING_BUDGETS" -- packages/ai/src/providers  # → matches in anthropic.ts and google.ts
> # AI SDK 7 exposes the portable option this plan targets.
> grep -n "reasoning?: LanguageModelV4CallOptions\['reasoning'\]" packages/core/node_modules/ai/dist/index.d.ts  # → 1 match
> ```

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED. Changes the request bodies sent to Anthropic and Gemini 2.5 when reasoning is configured.
- **Depends on**: #188, #196, #198 (all merged). No plan dependencies.
- **Category**: tech-debt
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: yes, minor under pre-1.0 rules. `AiRegistry.resolveProviderOptions` is removed and replaced by `resolveReasoning`. Built-in adapters no longer implement the `resolveProviderOptions` hook. `@askdb/core` gains an additive `deps.reasoning`.

## Why this matters

`@askdb/ai` turns a portable `reasoningEffort` ("minimal" | "low" | "medium" | "high") into each provider's native `providerOptions` by hand: OpenAI `reasoningEffort`, Anthropic `thinking` budgets and adaptive `effort`, and Gemini `thinkingBudget` / `thinkingLevel`. The token budgets and the adaptive-versus-budget split are tables AskDB has to keep in step with every new model family. AI SDK 7 (`ai@7`) added a portable top-level `reasoning` call option. Each provider package maps it natively, and those packages already carry the same model-capability tables, updated with each provider release.

After this plan, AskDB only decides whether reasoning should be sent at all. The AI SDK decides how to send it. The mapping tables go away, and the gateway provider gets reasoning support.

The review (`docs/reviews/2026-09-25-architecture-and-release-review.md`, "One package per LLM provider") recorded this as a follow-up.

## Current state

Verified on `review/integration-check @ c7404d4`.

### The adapter hook and the registry method (`packages/ai/src/provider.ts`)

```ts
  resolveProviderOptions?(
    config: AiConfig,
    settings: ReasoningSettings,
  ): Record<string, unknown> | undefined;
```

`AiRegistry.resolveProviderOptions(config, settings)` delegates to it in `packages/ai/src/registry.ts`:

```ts
    resolveProviderOptions(config, settings) {
      return adapterFor(config.provider).resolveProviderOptions?.(config, settings);
    },
```

### Per-provider mappings (`packages/ai/src/providers/*.ts`)

- `openai.ts`: `isReasoningModel()` (o-series, or gpt-5+ excluding **every** `-chat` variant) → `{ openai: { reasoningEffort } }`.
- `azure.ts`: the same regex, applied to `providerOptions.modelFamily ?? config.model`, then `{ openai: { reasoningEffort, forceReasoning: true } }`. The long comment explains why `forceReasoning` is required: the AI SDK decides reasoning support from the **deployment name** and otherwise drops the effort silently. That stays true on the native path. `@ai-sdk/openai`'s Responses model computes `isReasoningModel = openaiOptions.forceReasoning ?? modelCapabilities.isReasoningModel` and only emits `reasoning` when that is true.
- `anthropic.ts`: `ADAPTIVE_THINKING_MODEL_PATTERN`, `BUDGET_THINKING_MODEL_PATTERN`, `THINKING_BUDGETS` (1024/2048/8192/16384), `ADAPTIVE_EFFORTS`.
- `google.ts`: `GEMINI_3_PATTERN` → `thinkingLevel: effort`, `GEMINI_25_PATTERN` → `thinkingBudget` from `GEMINI_25_THINKING_BUDGETS` (0/1024/8192/24576, with Pro floored at 128).
- `gateway.ts`: `// No resolveProviderOptions yet: reasoning effort is not mapped for gateway models`.

### Callers (all first-party)

- `packages/client/src/client.ts` `resolveModel()`: `registry.resolveProviderOptions(cachedAiConfig, { reasoningEffort })`, then merged as `deps.providerOptions`. An explicit caller `deps.providerOptions` wins.
- `apps/studio/src/server.ts` `suggestForSource()` (enrichment) and the sample-generation handler: `ai.resolveProviderOptions(aiConfig, { reasoningEffort })`.
- Core forwards the bag verbatim: `packages/core/src/sql/generate.ts` (`GenerateSqlDeps.providerOptions`, spread into `generateText`), `packages/core/src/enrichment/suggest.ts` (`SuggestEnrichmentDeps.providerOptions`), and `packages/core/src/ask.ts` (`AskGenerateDeps.providerOptions`, the `AskDialect.generate` deps type, and the forwarding in `ask()`).

### Facts about the native option (verified in `node_modules`, `ai@7.0.51`, `@ai-sdk/*@4`)

- `ai@7` `LanguageModelCallOptions.reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`.
- **`ai@6` does not have it.** `ai@6.0.291` (latest 6.x) has no `reasoning` call setting, and its `prepareCallSettings` destructures only known keys, so a `reasoning` key is **silently ignored**. `@askdb/core` supports `ai@^6 || ^7` (#196). `@askdb/ai` and `@askdb/client` peer on `ai@^7.0.51` only.
- **The native mapping does not gate unsupported models.**
  - `@ai-sdk/google` `resolveThinkingConfig` sends a `thinkingBudget` to any non-Gemini-3 model, including `gemini-2.0-flash`, AskDB's default.
  - `@ai-sdk/anthropic` `resolveAnthropicReasoningConfig` sends budget thinking to Claude 3.x.
  - `reference/config.mdx` promises users that models without reasoning support "never receive these options". **AskDB must keep its capability gates.**
- The OpenAI Responses model self-gates. It also treats `gpt-5.1-chat-latest` as a reasoning model, where AskDB's gate is more conservative. Keep AskDB's gate.
- `@ai-sdk/gateway` forwards all call options (`getArgs` strips only `abortSignal`), so `reasoning` reaches the gateway.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build / lint / test | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| One file | `pnpm --filter @askdb/ai exec vitest run --config ../../vitest.config.ts src/providers/anthropic.contract.test.ts` | pass |
| Docs | `pnpm docs:build` | exit 0 |
| Release gates | `pnpm smoke:install && pnpm preflight` | exit 0 (smoke includes the `consumer-ai6` AI SDK 6 fixture) |
| Changesets | `pnpm changeset status` | no unexpected `major` |

## Scope

**In scope**:
- `packages/ai/src/provider.ts`, `registry.ts`, `reasoning.ts`, `index.ts`
- `packages/ai/src/providers/{openai,azure,anthropic,google,gateway}.ts`
- `packages/ai/src/providers/reasoning-support.ts` (create; the shared "does this model support reasoning" predicates)
- Their tests: `packages/ai/src/providers/*.test.ts`, `*.contract.test.ts`, `packages/ai/src/registry.test.ts`
- `packages/core/src/ask.ts`, `packages/core/src/sql/generate.ts`, `packages/core/src/enrichment/suggest.ts`, core tests covering the `generateText` call shape
- `packages/client/src/client.ts` and its test; `apps/studio/src/server.ts` (the two reasoning call sites)
- `examples/installable-smoke/consumer-ai6/src/smoke.ts` (one assertion)
- Docs: `packages/ai/README.md` ("Reasoning/latency effort"), `apps/docs-site/src/content/docs/reference/config.mdx` (`ai.reasoning` section), `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` ("Reasoning/latency effort"), `docs/architecture.md` (the `@askdb/ai` boundary bullet), `docs/adrs/0006-ai-provider-integration-strategy.md` (append a dated note; its amendment lists this item under "Deferred: … adopting `ai@7`'s portable top-level `reasoning` call option")
- `.changeset/native-reasoning-option.md` (create)

**Out of scope**:
- Adding `"none"` / `"xhigh"` to `REASONING_EFFORTS` / `ASKDB_REASONING_EFFORTS`. That extends the config enum; do it as a separate change.
- Changing how an explicit caller `deps.providerOptions` interacts with computed options. It still replaces the computed bag wholesale; keep that behavior.
- `@askdb/config` (`ai.reasoning` flattening and env keys stay unchanged).
- Any change to `temperature: 0` in core's `generateText` calls.

## Git workflow

- Branch `plan/057-native-reasoning-option`. Use conventional commits, e.g. `refactor(ai)!: send reasoning via AI SDK 7's native option`.
- Open one PR and don't merge it.

## Steps

### Step 1: Pin today's request bodies before changing anything

For each built-in provider, run the existing contract tests. Record, in the PR description, the reasoning-related part of the captured body for these models at `low` and `minimal`: OpenAI `gpt-5`, `o3-mini`, and `gpt-4o-mini`; Azure deployment `askdb-reporting` with `modelFamily: "gpt-5"`; Anthropic `claude-sonnet-4-6`, `claude-sonnet-4-5`, and `claude-3-5-haiku-latest`; Google `gemini-3-pro-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`, and `gemini-2.0-flash`. Use the `captureGenerate` pattern already in `google.contract.test.ts` (stub `fetch`, run real `generateText`, read the JSON body).

**Verify**: `pnpm --filter @askdb/ai test` → all pass. The PR description has a "before" table.

### Step 2: Add the native-path API in `@askdb/ai`

1. In `reasoning.ts`, add and export:

   ```ts
   /** What to pass to AI SDK 7's `generateText` for a resolved reasoning effort. */
   export type ReasoningCallSettings = {
     /** AI SDK 7's portable top-level `reasoning` call option. */
     reasoning?: ReasoningEffort;
     /** Provider options that must accompany it (e.g. Azure `forceReasoning`). */
     providerOptions?: Record<string, unknown>;
   };
   ```

2. In `provider.ts`, add an optional adapter hook `resolveReasoning?(config, settings): ReasoningCallSettings | undefined`. The contract is that it returns `undefined` when the effort is unset **or the model does not support reasoning**. Mark the adapter hook `resolveProviderOptions` `@deprecated` in favor of `resolveReasoning`, and keep it so custom adapters continue to work.

3. In `AiRegistry`, remove `resolveProviderOptions` and add `resolveReasoning(config, settings)`. Implement it in `registry.ts` as: the adapter's `resolveReasoning` if defined; otherwise, if the adapter defines the deprecated `resolveProviderOptions`, wrap its result as `{ providerOptions }`; otherwise `undefined`.

4. Create `providers/reasoning-support.ts` with the capability predicates only:
   - `supportsOpenAiReasoning(model)`: move `isReasoningModel` from `openai.ts` verbatim, and delete the duplicate in `azure.ts`.
   - `supportsAnthropicThinking(model)`: the union of today's two Anthropic patterns.
   - `supportsGeminiThinking(model)`: `/^gemini-3/i` or `/^gemini-2\.5/i`.

5. Implement `resolveReasoning` in each built-in adapter:
   - openai: `supportsOpenAiReasoning(config.model)` → `{ reasoning }`.
   - azure: the same predicate applied to `modelFamily ?? config.model` → `{ reasoning, providerOptions: { openai: { forceReasoning: true } } }`. Keep the comment explaining why.
   - anthropic: `supportsAnthropicThinking` → `{ reasoning }`.
   - google: `supportsGeminiThinking` → `{ reasoning }`.
   - gateway: split `config.model` on the first `/`. Apply the matching predicate for the `openai`, `anthropic`, or `google` upstream to the rest of the id and return `{ reasoning }`. For any other upstream, return `undefined`.

6. Delete `resolveProviderOptions` from all built-in adapters, along with `THINKING_BUDGETS`, `ADAPTIVE_EFFORTS`, `resolveThinkingMode`, `GEMINI_25_THINKING_BUDGETS`, and `resolveGemini25ThinkingBudget`.

7. Export `ReasoningCallSettings` from `index.ts`.

**Verify**: `pnpm --filter @askdb/ai lint` → exit 0. `git grep -n -E "THINKING_BUDGETS|ADAPTIVE_EFFORTS|resolveGemini25ThinkingBudget" packages/ai/src` → no matches.

### Step 3: Forward `reasoning` from `@askdb/core`

Add `reasoning?: "minimal" | "low" | "medium" | "high"` beside every `providerOptions` field: `AskGenerateDeps`, the `AskDialect.generate` deps type in `ask.ts`, `GenerateSqlDeps`, and `SuggestEnrichmentDeps`. Forward it in `ask()` the same way `providerOptions` is forwarded.

Declare the type locally as a string-literal union. Don't import it from `ai` or `@askdb/ai`: core must still type-check its public types for `ai@6` hosts, and it must not depend on `@askdb/ai`.

In both `generateText` calls, spread `reasoning` only when it is set and the model can honor it:

```ts
// AI SDK 6 has no `reasoning` call option and silently ignores it; AI SDK 7
// providers (LanguageModelV4) and gateway string ids map it natively.
const supportsNativeReasoning =
  typeof model === "string" || (model as { specificationVersion?: string }).specificationVersion === "v4";
...(deps.reasoning && supportsNativeReasoning ? { reasoning: deps.reasoning } : {}),
```

When `deps.reasoning` is set but dropped, emit one `logger?.warn` with a new `AskDbLogEvent` entry. Follow the existing enum in `packages/core/src/logging/log-events.ts`. The message must tell AI SDK 6 hosts to pass provider-specific `deps.providerOptions` instead. Update the JSDoc on the `providerOptions` fields: that bag remains the AI SDK 6 path and the escape hatch.

**Verify**: `pnpm --filter @askdb/core lint && pnpm --filter @askdb/core test` → exit 0.

### Step 4: Switch the first-party callers

- `packages/client/src/client.ts`: replace `registry.resolveProviderOptions(...)` with `registry.resolveReasoning(...)`. Carry both fields on `ResolvedModel`. Merge rules: an explicit `deps.reasoning` wins over the computed `reasoning`, and an explicit `deps.providerOptions` still replaces the computed `providerOptions` as it does today. Update the comment that describes this.
- `apps/studio/src/server.ts`: at both call sites, pass `{ reasoning, providerOptions }` into `suggestEnrichment` / `ask` deps. Omit any key whose value is `undefined`.

**Verify**: `git grep -n "resolveProviderOptions" -- 'packages/*/src' 'apps/*/src' ':!*.test.ts'` → matches only the deprecated adapter hook and its registry fallback. Then `pnpm build && pnpm lint` → exit 0.

### Step 5: Tests (apply the test-audit authoring gate, `.agents/skills/test-audit/SKILL.md`)

The owner boundary for "what goes on the wire" is the real-SDK contract tests (`*.contract.test.ts`). Rewrite the reasoning cases so they pass `resolveReasoning`'s output to `generateText` as `reasoning` + `providerOptions`, then assert on the captured body:

- **OpenAI**: `gpt-5` and `o3-mini` → `reasoning.effort` present. `gpt-4o-mini`, `gpt-5-chat-latest`, and `gpt-5.1-chat-latest` → no `reasoning`. Regression caught: the gate is lost, or the SDK gate is trusted for chat variants.
- **Azure**: deployment `askdb-reporting` + `modelFamily: "gpt-5"` → `reasoning.effort` present. Regression caught: `forceReasoning` is dropped.
- **Anthropic**: `claude-sonnet-4-6` → adaptive thinking. `claude-sonnet-4-5` → `thinking.type: "enabled"` with a `budget_tokens`. `claude-3-5-haiku-latest` → no `thinking`. Regression caught: native budget thinking reaching a model without thinking support.
- **Google**: `gemini-3-*` → `thinkingLevel`. `gemini-2.5-flash` → `thinkingBudget`. `gemini-2.0-flash` → no `thinkingConfig`. Same regression class as Anthropic.
- **Gateway** (new, in `gateway.contract.test.ts`): `openai/gpt-5` → body contains `"reasoning"`. `openai/gpt-4o-mini` and `xai/grok-4` → body has no `reasoning`.

Also:

- Delete the mapping-table unit tests in `openai.test.ts`, `azure.test.ts`, `google.test.ts`, and `anthropic.test.ts`, such as "allows thinkingBudget: 0". The contract tests now own the behavior they covered.
- Keep one `registry.test.ts` case for the deprecated-hook fallback: a custom adapter with only `resolveProviderOptions` still yields `{ providerOptions }`.
- **Core**: add one `generate` test with a `MockLanguageModelV4` (from `ai/test`) asserting `reasoning` reaches `doGenerate`'s call options. Add one with a V3 mock asserting that `reasoning` is omitted and the warning is logged.
- **AI SDK 6 smoke** (`consumer-ai6/src/smoke.ts`): call `ask()` with `deps: { reasoning: "low", providerOptions: { openai: { reasoningEffort: "low" } } }`. Assert it does not throw, and that `model.doGenerateCalls[1].providerOptions` carries the bag. That proves the AI SDK 6 path still works.

**Verify**: `pnpm test` → exit 0. `pnpm smoke:install` → exit 0.

### Step 6: Docs, changeset, full gate

- `reference/config.mdx` `ai.reasoning`: replace the per-provider mapping sentence. AskDB now sends AI SDK 7's `reasoning` option and each provider package maps it. Keep the list of excluded models and the "never receive" promise, since the gates enforce it. Keep the Azure `modelFamily` paragraph. Add one line: with AI SDK 6 BYO models, pass `deps.providerOptions` yourself.
- `guides/bring-your-own-model.mdx` "Reasoning/latency effort": update the programmatic snippet from `ai.resolveProviderOptions(...)` → `deps.providerOptions` to `ai.resolveReasoning(config, { reasoningEffort: "low" })` → spread into `deps`. Compile-check the snippet in a scratch file under `examples/ask-question/`, then delete the scratch file.
- `packages/ai/README.md` "Reasoning/latency effort" and `docs/architecture.md` (the "Each built-in owns … reasoning mapping" sentence): say "reasoning **support gate**", and name the gateway.
- ADR 0006: append one dated paragraph saying the deferred `reasoning` item landed, and why AskDB keeps capability gates (the native mapping does not gate models without reasoning support). Don't edit the existing text.
- Changeset `.changeset/native-reasoning-option.md`: `@askdb/ai` minor, `@askdb/core` minor (additive `deps.reasoning`), `@askdb/client` patch, `@askdb/studio` patch. Include a migration note for `resolveProviderOptions` → `resolveReasoning`. Call out the budget changes: Anthropic budgets are now a share of the model's max output tokens, and Gemini 2.5 `minimal` no longer disables thinking. Copy the actual numbers from your Step 1 "before" table and the new bodies.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → all exit 0. `pnpm changeset status` → no package bumped `major`. If the peer-dependents rule bumps one, STOP.

## Done criteria

- [ ] Readiness check passed; the "before" and "after" request-body table is in the PR description.
- [ ] `git grep -n -E "THINKING_BUDGETS|ADAPTIVE_EFFORTS|GEMINI_25_THINKING_BUDGETS" packages/ai/src` → no matches.
- [ ] `git grep -n "resolveProviderOptions(" -- packages/client/src apps/studio/src` → no matches.
- [ ] Contract tests cover gated-out models for openai, anthropic, google, and gateway, and all pass.
- [ ] The `consumer-ai6` smoke passes with the new assertion.
- [ ] All gates in Step 6 exit 0. The changeset exists and `pnpm changeset status` shows no `major`.
- [ ] The four docs surfaces are updated, and `pnpm docs:build` passes.

## STOP conditions

- A contract test shows that an **excluded** model receives a reasoning, thinking, or thinkingConfig field on the native path, even with the gate in place. That means the gate isn't being applied.
- The Azure body lacks `reasoning.effort` even with `providerOptions.openai.forceReasoning: true` alongside native `reasoning`.
- `generateText`'s type rejects `reasoning` when `model` is an `AskDbLanguageModel` union under core's `ai@7` devDependency, and fixing it needs a cast beyond the existing `providerOptions` cast pattern.
- Any provider's "after" body differs from the "before" body in a way not listed here: budget sizes, Anthropic `display: "summarized"`, or Gemini 2.5 `minimal`. Report the diff.
- `pnpm changeset status` shows a `major` bump.

## Maintenance notes

- Split of responsibilities: AskDB owns **whether** reasoning is sent (conservative gates in `reasoning-support.ts`), and the AI SDK owns **how**. When a provider ships a new reasoning family, update the gate regex only.
- `AiProviderAdapter.resolveProviderOptions` is deprecated but still honored. Remove it at the 1.0 cutover (same gate as plan 060).
- AI SDK 6 hosts never get `reasoning`. If core ever drops `^6`, remove the `specificationVersion` check and the warning.
- **Reviewer focus**: the before/after body table, the gateway prefix gate, and the fact that client merge semantics for explicit `deps.providerOptions` are unchanged.
