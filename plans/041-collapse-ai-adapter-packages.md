# Plan 041: Collapse the four `@askdb/ai-*` adapter packages into `@askdb/ai` with lazy provider loading

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/ai packages/ai-openai packages/ai-azure packages/ai-google packages/ai-anthropic packages/config/src apps/cli/src/cli.ts apps/http-api/src/server.ts apps/studio/src/server.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 035 (peer-dependency graph) — hard. Land 035 first; this plan assumes `@ai-sdk/*` are already peers rather than dependencies.
- **Category**: tech-debt
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: **Yes.** `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, and `@askdb/ai-anthropic` become deprecated re-export shims. All packages are pre-1.0 beta, which is why now is the moment.
- **Supersedes a prior decision**: ADR 0006 (Accepted, 2026-06-11) chose **Option F** — "`@askdb/ai` plus provider-specific packages now" — over **Option E**, a single `@askdb/ai` with providers as optional peers. This plan moves to Option E. The ADR's own text at lines 136-143 already anticipated Option E's benefits; what it could not weigh was Option F's realized maintenance cost. Step 0 amends the ADR; do not skip it. `plans/README.md` also records "making `@askdb/config`'s per-provider discriminated union provider-agnostic" as out of scope for an earlier cycle, to be revisited with its own ADR — Step 6 is that revisit.

## Why this matters

Each adapter package contains roughly 25 lines of genuinely provider-specific *data* — env var names, a default model, a factory call, a reasoning-effort mapping — wrapped in a full npm package: its own version, changelog, tsconfig, README, release, and a place in the dependency graph.

The costs are concrete:

- **Adding a provider is a six-step, ~15-file ritual.** The repo has a skill, `.agents/skills/new-ai-adapter/SKILL.md`, purely to automate it: new package, three app wirings, a `@askdb/config` branch, the smoke script, four docs locations, and a changeset.
- **Providers are enumerated in four places** — the adapter, `types.ts`, `flatten.ts`, and `constants.ts` — and they have already drifted: `packages/config/src/constants.ts:28` reads `export const ASKDB_AI_PROVIDERS = ["openai", "azure", "foundry", "google"] as const;` which is **missing `anthropic`**, a provider that has shipped.
- **The split delivers no install savings where it matters.** All three surfaces eagerly register all four adapters at module scope (`apps/cli/src/cli.ts:31`, `apps/http-api/src/server.ts:32`, `apps/studio/src/server.ts:91`), so the `askdb` CLI loads four provider SDKs regardless of which one is configured.
- **The consumer-facing simplicity never arrived.** A user must install two packages and import two symbols to say "use OpenAI."

The fix is not to delete the capability — the env-precedence resolution and the provider-portable reasoning mapping are genuinely valuable and unavailable from `ai` directly. The fix is to stop paying package-boundary costs for data, using the lazy-load pattern this repo already ships in `packages/rag/src/embedders/openai.ts:31`.

## Current state

### The four adapters

Each exports one object implementing `AiProviderAdapter`. `packages/ai-openai/src/index.ts` in full is 51 lines:

```ts
import { createOpenAI } from "@ai-sdk/openai";
import {
  resolveBaseConfig,
  withEmbeddingProviderOptions,
  type AiProviderAdapter,
  type ProviderEnvSpec,
} from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["OPENAI_API_KEY"],
  apiKeySecondaryVars: ["OPENAI_API_KEY_SECONDARY"],
  modelVars: ["OPENAI_MODEL"],
  embeddingModelVars: ["OPENAI_EMBEDDING_MODEL"],
  baseURLVars: ["OPENAI_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

/** o-series (o1, o3, o3-mini, o4-mini, …) and gpt-5.x — the OpenAI model families that accept `reasoningEffort`. */
const REASONING_MODEL_PATTERN = /^o\d(-|$)|^gpt-5/i;
// … isReasoningModel, then:

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
  configHint: "For OpenAI, set ai.provider: \"openai\" and ai.providerConfig.openai.apiKey in askdb.config.*.",
  resolveConfig(env, options) { return resolveBaseConfig("openai", env, ENV_SPEC, options); },
  createLanguageModel(config) { /* createOpenAI({apiKey, baseURL})(config.model) */ },
  createEmbeddingModel(config, options = {}) { /* … withEmbeddingProviderOptions(model, "openai", options) */ },
  resolveProviderOptions(config, { reasoningEffort }) {
    if (!reasoningEffort || !isReasoningModel(config.model)) return undefined;
    return { openai: { reasoningEffort } };
  },
};
```

Source sizes: `ai-openai` 51 lines, `ai-anthropic` 59, `ai-google` 77, `ai-azure` 120 (Azure is the largest — it carries `resourceName`/`apiVersion`/ `modelFamily` connection plumbing at `packages/ai-azure/src/index.ts:39-64` and a note at lines 97-100 that Azure must emit `providerOptions.openai`, not `.azure`). All that logic is preserved verbatim by this plan; only its packaging changes.

### The contract, which does not change

`packages/ai/src/provider.ts:156-187` defines `AiProviderAdapter` with `provider`, `aliases`, `configHint`, `resolveConfig`, `createLanguageModel`, `createEmbeddingModel`, and the optional `resolveProviderOptions`. `createAiRegistry(adapters)` at line 238 normalizes an array or record into a provider→adapter map. `AiProviderAdapters` (line 189) is `readonly AiProviderAdapter[] | Partial<Record<AiProvider, AiProviderAdapter>>`.

**This interface stays.** Third parties and the `new-ai-adapter` skill keep registering custom providers through it.

### The lazy-load pattern already in the repo

`packages/rag/src/embedders/openai.ts:27-42`:

```ts
export function createOpenAiEmbedder(options: CreateOpenAiEmbedderOptions = {}): Embedder {
  return async (texts: string[]) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    ...
  };
}
```

with `@ai-sdk/openai` declared as an **optional peer** in `packages/rag/package.json`. Copy this shape exactly.

### The four enumeration sites in `@askdb/config`

- `packages/config/src/types.ts:93-131` — `AiProviderConfigs` plus a discriminated-union branch per provider.
- `packages/config/src/flatten.ts:140-155` — an if/else chain:
  ```ts
  if (config.ai.provider === "openai") {
    set(out, "ASKDB_AI_PROVIDER", "openai");
    applyOpenAiAi(out, requireProviderBranch("openai", (config.ai as OpenaiAiConfig).providerConfig?.openai));
  } else if (config.ai.provider === "azure") {
  ```
- `packages/config/src/constants.ts:28` — the stale `ASKDB_AI_PROVIDERS`, exported publicly from `packages/config/src/index.ts:69,80`.
- Each adapter's own `ENV_SPEC`.

### The eager registration in all three apps

`apps/cli/src/cli.ts:31` (identical shape in the other two):

```ts
const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider]);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Typecheck | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Install smoke | `pnpm smoke:install` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `docs/adrs/0006-ai-provider-integration-strategy.md` — amendment only (Step 0)
- `packages/ai/src/providers/{openai,azure,google,anthropic}.ts` (create)
- `packages/ai/src/providers/index.ts` (create) — the built-in registry table
- `packages/ai/src/provider.ts` — accept provider-name strings; lazy resolution
- `packages/ai/src/index.ts` — new exports
- `packages/ai/package.json` — optional peers for the four `@ai-sdk/*`
- `packages/ai/src/**/*.test.ts` — moved and new tests
- `packages/ai-openai/src/index.ts`, `packages/ai-azure/src/index.ts`, `packages/ai-google/src/index.ts`, `packages/ai-anthropic/src/index.ts` — reduced to deprecated re-export shims
- The four shim `package.json` files — deprecation note in `description`
- `packages/config/src/flatten.ts`, `types.ts`, `constants.ts`
- `packages/client/src/client.ts` — accept provider-name strings
- `apps/cli/src/cli.ts`, `apps/http-api/src/server.ts`, `apps/studio/src/server.ts`
- `.agents/skills/new-ai-adapter/SKILL.md`
- `.changeset/collapse-ai-adapters.md` (create)

**Out of scope** (do NOT touch):
- **Deleting the four packages.** They become shims in this plan and are removed in a later release. Deleting now strands anyone on the beta.
- Any change to `AiProviderAdapter`'s shape. The extension point must stay source-compatible so third-party adapters keep working.
- The reasoning-effort mappings themselves — the model-family regexes, the Anthropic `budgetTokens` table, the Gemini `thinkingBudget` values, the Azure `providerOptions.openai` quirk. Move them **verbatim**. Any behavior change here is a separate plan.
- `packages/rag/**`.
- Docs and positioning beyond the mechanical updates — plan 042 owns that.

## Git workflow

- Branch: `advisor/041-collapse-ai-adapter-packages`
- One commit per step. This plan is large; a reviewable history matters.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Amend ADR 0006 before touching any code

`docs/adrs/0006-ai-provider-integration-strategy.md` is **Accepted** and its decision (line 164) reads:

```
Adopt Option F: extract provider construction out of `@askdb/core`, keep `@askdb/core`
BYO-model, make `@askdb/ai` the shared registry/config package, and publish provider-specific
packages for the concrete provider factories.
```

This plan moves to Option E, which the same ADR describes at lines 126-143. Record that before implementing it.

Append an **Amendment** section (append-only — do not rewrite the original decision). Check `docs/adrs/0005-askdb-config-and-env-bootstrap.md` for an established amendment format and match it. State:

- Date; that it amends the 2026-06-11 Option F decision to Option E.
- What stays: `@askdb/core` remains BYO-model and never depends on `@askdb/ai`; `AiProviderAdapter` remains the public extension point; provider SDKs remain optional, now as optional peers of `@askdb/ai` rather than dependencies of separate packages.
- What changes: the four `@askdb/ai-*` packages become deprecated shims; provider construction is lazily imported from within `@askdb/ai`.
- Why: Option F's per-package granularity did not deliver its predicted benefit — all three first-party surfaces register all four adapters eagerly, so nothing is saved where most users meet AskDB — while its costs were higher than predicted: four release units in version lockstep, providers enumerated in four places, and observed drift (`packages/config/src/constants.ts:28` is missing `anthropic`).
- Note that ADR 0006's Option E analysis (lines 136-143) already recorded the benefits now being adopted.

**Verify**: `grep -n "Amendment" docs/adrs/0006-ai-provider-integration-strategy.md` → returns a match. `pnpm docs:build` → exit 0.

### Step 1: Move the four adapters into `@askdb/ai` behind lazy imports

Create `packages/ai/src/providers/openai.ts` by copying `packages/ai-openai/src/index.ts` and changing exactly two things:

1. Replace the static `import { createOpenAI } from "@ai-sdk/openai";` with a dynamic import inside each factory method.
2. Change the `@askdb/ai` imports to relative paths (`../provider.js`, `../embedding.js`).

```ts
  async createLanguageModel(config) {
    // Lazily imported so installing @askdb/ai does not pull in every provider
    // SDK — only the one you actually configure. @ai-sdk/openai is an optional
    // peer dependency; see packages/rag/src/embedders/openai.ts for the same pattern.
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return openai(config.model);
  },
```

`AiProviderAdapter.createLanguageModel` already permits a `Promise<LanguageModel>` return (`packages/ai/src/provider.ts:168`), so making these `async` needs no interface change.

Repeat for `azure.ts`, `google.ts`, `anthropic.ts`. Preserve every regex, budget table, comment, and error message exactly — including Anthropic's `createEmbeddingModel` throw and Azure's `providerOptions.openai` comment.

Move each package's `src/index.test.ts` to `packages/ai/src/providers/<name>.test.ts`, adjusting imports only.

**Verify**:
```
pnpm --filter @askdb/ai lint
pnpm --filter @askdb/ai test
```
→ exit 0, all moved tests pass.

### Step 2: Add the built-in provider table and declare optional peers

Create `packages/ai/src/providers/index.ts` exporting a name→adapter record of the four built-ins, and a resolver used when a caller passes a provider *name* rather than an adapter object.

In `packages/ai/package.json`, add the four provider SDKs as **optional** peers plus dev dependencies, following `packages/rag/package.json`'s shape exactly:

```json
  "peerDependencies": {
    "@ai-sdk/anthropic": "^4.0.29",
    "@ai-sdk/azure": "^4.0.30",
    "@ai-sdk/google": "^4.0.33",
    "@ai-sdk/openai": "^4.0.29",
    "ai": "^7.0.51"
  },
  "peerDependenciesMeta": {
    "@ai-sdk/anthropic": { "optional": true },
    "@ai-sdk/azure": { "optional": true },
    "@ai-sdk/google": { "optional": true },
    "@ai-sdk/openai": { "optional": true }
  },
```

Add all four to `devDependencies` too, or the workspace build breaks.

**Verify**: `pnpm install && pnpm --filter @askdb/ai build && pnpm --filter @askdb/ai test` → exit 0.

### Step 3: Let `createAiRegistry` accept provider names

Widen `AiProviderAdapters` to accept strings alongside adapter objects, and make `createAiRegistry()` with no arguments register all four built-ins:

```ts
export type AiProviderSelector = AiProvider | AiProviderAdapter;
export type AiProviderAdapters =
  | readonly AiProviderSelector[]
  | Partial<Record<AiProvider, AiProviderAdapter>>;
```

Rules:
- A string resolves through the built-in table; an unknown string throws the existing `aiProviderMissingMessage` (`packages/ai/src/provider.ts:345`).
- An object is used as-is — third-party adapters keep working unchanged.
- No arguments registers all four built-ins.

Because loading is lazy, registering all four costs nothing until one is used.

Add a clear error for the missing-peer case. When `await import("@ai-sdk/openai")` throws `ERR_MODULE_NOT_FOUND`, catch it and rethrow as: `OpenAI provider selected but "@ai-sdk/openai" is not installed. Run: npm install @ai-sdk/openai`

**Verify**:
```
pnpm --filter @askdb/ai test
node --input-type=module -e "
import('./packages/ai/dist/index.js').then(async (m) => {
  const r = m.createAiRegistry();
  if (!r.hasProvider('openai') || !r.hasProvider('anthropic')) throw new Error('built-ins missing');
  if (!r.hasProvider('foundry')) throw new Error('azure alias missing');
  console.log('registry OK');
});"
```
→ `registry OK` (run after `pnpm --filter @askdb/ai build`).

### Step 4: Reduce the four packages to deprecated shims

Replace each `packages/ai-*/src/index.ts` with a re-export:

```ts
/**
 * @deprecated Import from `@askdb/ai` instead — the OpenAI adapter now ships
 * there, with `@ai-sdk/openai` as an optional peer dependency:
 *
 *   import { createAiRegistry } from "@askdb/ai";
 *   const registry = createAiRegistry(["openai"]);
 *
 * This package is a thin re-export and will be removed before 1.0.
 */
export { openaiProvider } from "@askdb/ai";
```

Add `@askdb/ai` to each shim's `dependencies` (a shim genuinely needs it), remove the `@ai-sdk/*` peer (the merged package owns it now), and prefix each `description` with `[Deprecated]`.

**Verify**: `pnpm build && pnpm test` → exit 0; every existing import of `openaiProvider` from `@askdb/ai-openai` still resolves.

### Step 5: Simplify the three app wirings

In `apps/cli/src/cli.ts`, `apps/http-api/src/server.ts`, and `apps/studio/src/server.ts`, delete the four adapter imports and replace the registry construction with:

```ts
const ai = createAiRegistry();
```

Remove the four `@askdb/ai-*` entries from each app's `package.json` dependencies. Add the four `@ai-sdk/*` packages as direct dependencies of each app — the surfaces are batteries-included and must ship all four.

**Verify**:
```
pnpm install && pnpm build
pnpm exec askdb ask --schema fixtures/schemas/orders-users.schema --question 'How many orders are there?' 2>&1 | head -5
grep -rn "@askdb/ai-openai" apps/*/src | wc -l
```
→ build exits 0; the `askdb ask` call may fail for a missing API key but must NOT fail with a module-resolution error; the grep count is `0`.

### Step 6: Make the `@askdb/config` provider handling generic

Replace the if/else chain at `packages/config/src/flatten.ts:140-155` with a lookup driven by the provider name. The mapping from a config branch to native env keys is data the provider descriptor already carries in its `ProviderEnvSpec` (`apiKeyVars`, `modelVars`, `baseURLVars`).

Two constraints:

- **`@askdb/config` must not take a runtime dependency on `@askdb/ai`.** Check the current dependency direction first (`node -e "console.log(require('./packages/config/package.json').dependencies)"`). If adding it would create a cycle, keep a small local table in `packages/config/src/` — one entry per provider naming its env keys — and add a test asserting it matches `@askdb/ai`'s specs. A duplicated table with a drift test is strictly better than today's four hand-maintained sites.
- Preserve the exact env keys each provider emits today. Existing deployments depend on them. The existing flatten tests are the contract.

Fix `packages/config/src/constants.ts:28` to include `anthropic`:

```ts
export const ASKDB_AI_PROVIDERS = ["openai", "azure", "foundry", "google", "anthropic"] as const;
```

and add a test asserting this list matches the built-in provider names plus aliases exported by `@askdb/ai`, so it cannot drift again.

**Verify**: `pnpm --filter @askdb/config test` → all pass, including existing flatten tests unchanged.

### Step 7: Let `createAskDb` take a provider name

In `packages/client/src/client.ts`, `CreateAskDbOptions.providers` (line 68) already accepts `AiProviderAdapters`, which Step 3 widened to include strings — so `providers: ["openai"]` works with no client change. Verify that, then update the error message at lines 106-109, which currently reads:

```ts
    "createAskDb: pass `providers` with the AI adapters for your configured provider " +
      '(e.g. `providers: [openaiProvider]` from "@askdb/ai-openai"), or a prebuilt `registry`.',
```

to recommend the string form and `@askdb/ai`. Update the JSDoc at lines 63-67 the same way.

Consider defaulting `providers` to all built-ins when neither `providers` nor `registry` is passed — that is the "simplicity out of the box" payoff, making `createAskDb({ config })` sufficient. Do this only if it does not weaken the error message when no API key is configured.

**Verify**: `pnpm --filter @askdb/client test && pnpm --filter @askdb/client lint` → exit 0.

### Step 8: Update the smoke test, the skill, and the changeset

- `examples/installable-smoke/run.sh` and `examples/installable-smoke/consumer/`: switch the consumer to `createAiRegistry(["openai"])` with `@ai-sdk/openai` installed directly. Keep one assertion that the `@askdb/ai-openai` shim still re-exports `openaiProvider`, so the deprecation path is tested.
- `.agents/skills/new-ai-adapter/SKILL.md`: rewrite for the new reality. Steps 1 (package scaffold) and 4.1 (three app wirings) disappear entirely. The new procedure is: add `packages/ai/src/providers/<name>.ts`, register it in the built-in table, add the optional peer, add a test, extend the config provider table, add a changeset. Update the "STOP conditions" accordingly.
- `.changeset/collapse-ai-adapters.md`: **minor** for `@askdb/ai`, `@askdb/client`, `@askdb/config`, `askdb`, `@askdb/http-api`, `@askdb/studio`; **patch** for the four deprecated shims. The body must show the before/after import, state that the shims still work but are deprecated, and tell readers to install the `@ai-sdk/*` package for their provider.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm docs:build` → all exit 0.

## Test plan

- **Moved tests**: the four adapters' existing `index.test.ts` files move to `packages/ai/src/providers/` and must pass unmodified except for import paths. This is the primary guarantee that behavior did not change.
- **New tests in `packages/ai`**:
  - `createAiRegistry()` with no args registers all four built-ins plus the Azure aliases (`azure-openai`, `foundry`).
  - `createAiRegistry(["openai"])` registers only OpenAI.
  - `createAiRegistry([customAdapter])` still works — construct a minimal object literal implementing `AiProviderAdapter`.
  - Mixed `createAiRegistry(["openai", customAdapter])` works.
  - An unknown provider string throws a message naming the registered providers.
  - A missing optional peer produces the actionable install message from Step 3 — simulate by mocking the dynamic import to reject with `ERR_MODULE_NOT_FOUND`.
- **New test in `packages/config`**: `ASKDB_AI_PROVIDERS` matches the built-in provider names and aliases from `@askdb/ai` (the anti-drift test).
- **Unchanged**: every existing `packages/config` flatten test must pass untouched. If one needs editing, the env-key contract broke — STOP.

## Done criteria

ALL must hold:

- [ ] `docs/adrs/0006-ai-provider-integration-strategy.md` contains an Amendment section (Step 0)
- [ ] `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `pnpm smoke:install` exits 0
- [ ] `pnpm docs:build` exits 0
- [ ] `grep -rn "@askdb/ai-openai\|@askdb/ai-azure\|@askdb/ai-google\|@askdb/ai-anthropic" apps/*/src` returns no matches
- [ ] `grep -c "anthropic" packages/config/src/constants.ts` is ≥ 1
- [ ] Each of the four `packages/ai-*/src/index.ts` is under 15 lines and contains `@deprecated`
- [ ] After build, `createAiRegistry()` with no args reports `hasProvider` true for `openai`, `azure`, `google`, `anthropic`, and `foundry`
- [ ] No existing `packages/config` flatten test was modified (`git diff --stat packages/config/src/flatten.test.ts` shows additions only)
- [ ] The four adapter test files exist under `packages/ai/src/providers/` and pass
- [ ] `.agents/skills/new-ai-adapter/SKILL.md` no longer instructs creating a new package
- [ ] `.changeset/collapse-ai-adapters.md` exists and lists all ten packages
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Making `createLanguageModel` async breaks a caller that relied on a synchronous return. `AiRegistry.createLanguageModel` is already declared `Promise<LanguageModel>` (`packages/ai/src/provider.ts:203`), so this should not happen — if it does, report where.
- Step 6 requires `@askdb/config` to depend on `@askdb/ai` and that creates a dependency cycle. Fall back to the local-table-plus-drift-test option described in that step and say so.
- Any existing `packages/config` flatten test fails. The emitted env keys are a compatibility contract; a failure means Step 6 changed behavior.
- A bundler in `apps/studio` (or its build) fails on the dynamic `import("@ai-sdk/…")` calls with unresolvable-module errors. This is the known trade-off of the lazy pattern; report the exact failure rather than reverting to static imports.
- The moved adapter tests fail. They should pass with only import-path edits; a real failure means logic was altered during the move.
- The total diff exceeds roughly 40 files. That signals scope creep — stop and report what pulled you outside the in-scope list.

## Maintenance notes

- **The four shims must be deleted before 1.0.** Track it. Leaving them indefinitely recreates the maintenance surface this plan removed.
- **Adding a provider is now**: one file in `packages/ai/src/providers/`, one table entry, one optional peer, one test, one config-table entry, one changeset. No new package, no app wiring. The rewritten skill must reflect exactly that.
- **The bundler caveat is real.** Dynamic `import()` of an optional peer makes Vite/webpack emit unresolved-module warnings when the provider is not installed. These are Node server-side surfaces and `@askdb/rag` already accepts this trade-off, but the explicit `providers: [adapterObject]` path must stay documented as the bundler-safe escape hatch. Plan 042 owns saying so.
- **Plan 034 (dual CJS/ESM publishing) interacts here.** If 034 has landed, `packages/ai` needs its `tsconfig.build.cjs.json` preserved through this restructure, and the dynamic imports must be verified in the CJS build too — `await import()` works from CommonJS, but confirm the emitted output kept it as a real dynamic import rather than a `require`.
- **Reviewer focus**: diff the four moved adapter files against their originals and confirm the only changes are the import style and the `async` keyword. The reasoning-effort mappings are subtle, provider-specific, and easy to corrupt silently.
