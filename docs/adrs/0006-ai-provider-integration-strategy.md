# ADR 0006 - AI provider integration strategy

## Status

Accepted (2026-06-11).

## Context

`@askdb/core` is the central dialect-agnostic NL-to-SQL pipeline. It currently depends on the Vercel AI SDK core package (`ai`) and concrete provider packages (`@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`). The pipeline API is already mostly correct: callers pass a model into `ask()`, and core does not read `process.env` or choose a provider during a request.

The problem is where the convenience provider construction lives. `@askdb/core` exports helpers such as `resolveAskDbAiConfig`, `createAskDbLanguageModelFromEnv`, `resolveAskDbEmbeddingConfig`, and `createAskDbEmbeddingModelFromEnv`. Those helpers construct OpenAI, Azure, and Google models from config/env maps, so every `@askdb/core` consumer installs the provider packages even when they only use one provider, provide their own AI SDK model, or do not use the env-based helpers at all.

This violates the package boundary from ADR 0002: core should own the pipeline, schema types, prompt assembly, SQL validation, tenant policy, logging contracts, retrieval input, and dialect orchestration. Provider bootstrap is integration/bootstrap code.

### What core actually needs from the AI SDK

Core's runtime AI SDK usage is intentionally small:

```ts
const result = await generateText({
  model,
  system,
  prompt,
  temperature: 0,
});

const text = result.text;
```

AskDB core does not use streaming, tool calling, image input, provider registries, or structured generation for the NL-to-SQL path. The model is only passed to `generateText`; core never constructs or inspects provider instances.

The AI SDK's `LanguageModel` contract remains a reasonable public seam for AskDB because it is already provider-neutral and supports AI SDK custom providers. AskDB does not need to define a smaller inference interface merely to enable custom providers.

## Considered Options

### Option A - Keep the current mixed core package

Keep `LanguageModel` from `ai` as the `ask()` contract. Keep all provider construction helpers in `@askdb/core`. Keep `@ai-sdk/openai`, `@ai-sdk/azure`, and `@ai-sdk/google` as hard dependencies of core.

Pros:

- No migration cost.
- First-party apps keep their current imports.

Cons:

- Every core consumer pays for all bundled provider packages.
- Adding provider support requires changing core.
- Core owns bootstrap concerns outside its stated responsibility.
- The package layout is inconsistent with database driver packages, which already use optional peer dependencies at integration boundaries.

### Option B - Pure BYO model only

Remove provider construction helpers from core and do not replace them. Integrators construct an AI SDK model themselves before calling `ask()`.

Pros:

- Cleanest `@askdb/core` dependency graph.
- Strongest dependency inversion: core only depends on the model contract.

Cons:

- First-party apps still need a shared home for provider/env resolution.
- Users who want AskDB's config-driven provider selection would copy provider wiring into their apps.
- `@askdb/config` would describe provider branches with no corresponding convenience model factory.

### Option C - Core fully manages AI

Change `ask()` to accept provider config and construct the model internally.

Pros:

- Lowest setup friction for a narrow default use case.

Cons:

- Removes the current BYO model escape hatch.
- Makes custom models, proxies, fine-tuned endpoints, and tests harder.
- Pushes even more integration/bootstrap logic into core.
- Conflicts with AskDB's "bring your own model" integration story.

### Option D - Define an AskDB-owned minimal inference interface

Define a new core interface such as:

```ts
export type AskDbLanguageModel = {
  generate(input: { system: string; prompt: string }): Promise<string>;
};
```

Then publish provider-specific wrappers around that interface.

Pros:

- `@askdb/core` no longer depends on `ai`.
- The interface is as small as AskDB's current needs.

Cons:

- Users who already have AI SDK models need an adapter.
- AskDB would own an abstraction that largely duplicates AI SDK's provider-neutral model contract.
- Future AI capabilities would require expanding or versioning the custom interface.
- More surface area with little immediate integration value.

### Option E - Extract provider construction to `@askdb/ai`

Keep the AI SDK `LanguageModel` contract for `ask()`. Remove concrete provider packages and provider construction helpers from `@askdb/core`. Create `@askdb/ai` as the home for AskDB's config/env-to-model helpers.

Pros:

- Core remains BYO-model and no longer installs concrete provider packages.
- First-party apps keep one shared implementation for provider/env resolution.
- Integrators who already use AI SDK providers do not need `@askdb/ai`.
- Integrators who want AskDB config-driven provider selection can install `@askdb/ai`.
- Provider packages become optional peers of the provider-construction layer.

Cons:

- Existing imports of provider helpers from `@askdb/core` must move to `@askdb/ai`.
- A single `@askdb/ai` package can grow into a registry package if many providers are added.
- Provider-specific dependencies are still declared by the shared helper package.

### Option F - `@askdb/ai` plus provider-specific packages now

Create a small `@askdb/ai` package for shared types/registry helpers and provider packages such as `@askdb/ai-openai`, `@askdb/ai-azure`, and `@askdb/ai-google`.

Pros:

- Most granular provider dependency graph.
- Each provider is independently installable and versionable.
- Provider-specific options stay close to the provider implementation.

Cons:

- More packages to publish, document, and version.
- First-party apps would need more explicit dependency wiring immediately.

## Decision

Adopt Option F: extract provider construction out of `@askdb/core`, keep `@askdb/core` BYO-model, make `@askdb/ai` the shared registry/config package, and publish provider-specific packages for the concrete provider factories.

### `@askdb/core`

- Remove `@ai-sdk/openai`, `@ai-sdk/azure`, and `@ai-sdk/google` from runtime dependencies.
- Retain `ai` as a runtime dependency while core calls `generateText`.
- Export an AskDB-owned name for the AI SDK model contract:

  ```ts
  export type { LanguageModel as AskDbLanguageModel } from "ai";
  ```

- Change public core types from `LanguageModel` to `AskDbLanguageModel`. This is a source-level naming change, not a behavioral change: callers can continue passing any AI SDK language model.
- Remove provider construction helpers from the core root export:
  - `resolveAskDbAiConfig`
  - `resolveAskDbEmbeddingConfig`
  - `createAskDbLanguageModel`
  - `createAskDbLanguageModelFromEnv`
  - `createAskDbEmbeddingModel`
  - `createAskDbEmbeddingModelFromEnv`
  - `askDbAiKeyMissingMessage`

Core should not re-export these helpers from `@askdb/ai`. A compatibility re-export would pull the new integration package back into core and weaken the dependency boundary. Because AskDB is still pre-1.0/beta, the import-path change is an acceptable breaking change when documented clearly.

### `@askdb/ai`

Create a workspace package for AskDB's shared AI config and provider registry.

`@askdb/ai` owns:

- Provider/env resolution types such as `AskDbAiProvider`, `AskDbAiConfig`, and `AskDbAiEnv`.
- `resolveAiConfig`.
- `resolveEmbeddingConfig`.
- Provider adapter types such as `AiProviderAdapter`.
- `createAiRegistry`.
- `aiKeyMissingMessage`.
- `aiProviderMissingMessage`.

Dependency model:

- `ai`: hard dependency, because registry methods return AI SDK model types.
- No concrete AI SDK provider packages.

### Provider Packages

Create provider-specific packages:

- `@askdb/ai-openai` depends on `@ai-sdk/openai` and exports `openaiProvider`.
- `@askdb/ai-azure` depends on `@ai-sdk/azure` and exports `azureProvider`.
- `@askdb/ai-google` depends on `@ai-sdk/google` and exports `googleProvider`.

First-party apps install and register the provider adapters they intentionally support. Library users install only the adapter packages they need.

## Integration Paths

### Existing AI SDK Users

Users who already construct an AI SDK model do not need `@askdb/ai`:

```ts
import { ask, loadSchema } from "@askdb/core";
import { openai } from "@ai-sdk/openai";

const schema = await loadSchema("./askdb");

await ask({
  question: "How many users signed up last month?",
  schema,
  dialect: "postgres",
  model: openai("gpt-4o-mini"),
});
```

### AskDB Config-Driven Provider Selection

Users who want AskDB's env/config provider resolution install `@askdb/ai` plus the provider adapter package they use:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { ask } from "@askdb/core";

const ai = createAiRegistry([openaiProvider]);

bootstrapAskDbEnv({ cwd: process.cwd() });

const runtime = getAskDbRuntimeConfig();
const model = await ai.createLanguageModelFromEnv(runtime.ai.aiEnv);

await ask({
  question,
  schema,
  dialect: "postgres",
  model,
});
```

### Fully Custom Providers

Users with an AI SDK-compatible custom provider pass the model directly:

```ts
import { ask } from "@askdb/core";
import { customProvider } from "your-custom-provider";

await ask({
  question,
  schema,
  dialect: "postgres",
  model: customProvider("your-model-id"),
});
```

No bridge adapter and no `@askdb/ai` package are required.

### First-Party Apps

First-party apps update imports from core to `@askdb/ai`:

```ts
import { createAiRegistry } from "@askdb/ai";
import { azureProvider } from "@askdb/ai-azure";
import { googleProvider } from "@askdb/ai-google";
import { openaiProvider } from "@askdb/ai-openai";
import { ask } from "@askdb/core";

const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider]);
```

Apps declare the provider packages they intentionally support as direct dependencies.

## Consequences

- `@askdb/core` loses hard dependencies on concrete AI SDK provider packages.
- `@askdb/core` keeps a dependency on `ai` while it uses `generateText`.
- Provider construction becomes an integration-layer concern in `@askdb/ai-*` packages.
- `@askdb/ai` owns config resolution and registry dispatch only.
- First-party apps and docs update provider-helper imports from `@askdb/core` to `@askdb/ai` plus the provider adapter packages.
- Consumers who import provider helpers from `@askdb/core` must update to `@askdb/ai` registry usage.
- `@askdb/rag` keeps its current optional peer dependency pattern for `ai`, `@ai-sdk/openai`, and `pg`. It should not rely on transitive availability of `ai`; any public type or runtime helper that uses AI SDK embedding models must continue declaring the relevant peer dependency.
- Adding a new provider no longer requires changing `@askdb/core`.
- Adding a new provider is a new `@askdb/ai-*` package plus a config branch when AskDB wants to support it through config/env resolution.

## Related

- ADR 0002 - Integration-package layout.
- ADR 0005 - AskDB config package and env bootstrap.
- `packages/core/src/sql/generate.ts` - current AI SDK runtime call site in core.
- `packages/ai/src/provider.ts` - shared config resolution and provider registry.
- AI SDK providers and models: <https://ai-sdk.dev/docs/foundations/providers-and-models>.
- AI SDK provider management: <https://ai-sdk.dev/docs/ai-sdk-core/provider-management>.

## Amendments

**2026-06 — Implemented, then extended (adapter contract v2):** The architecture described here shipped. It was then extended: `@askdb/ai` no longer hard-codes provider env vars or defaults — adapters are now self-describing via `resolveConfig`, `aliases`, and `providerOptions`. The `AiProvider` type is now an open `string` instead of a closed union (so third-party adapters don't require a core change). `ai` is a peer dependency of `@askdb/ai` and all first-party adapter packages rather than a hard dependency. Standalone `resolveAiConfig` / `resolveEmbeddingConfig` functions moved onto `createAiRegistry()` registry instances. The consequence "adding a new provider is a new `@askdb/ai-*` package plus a config branch" was superseded: a config branch in `askdb.config.*` is now only needed for authoring-time type support; env-driven use (`ASKDB_AI_PROVIDER=<name>`) works without it.

**2026-08 — Provider-portable reasoning/latency effort:** Added an AskDB-owned config surface for reasoning/latency tuning (`reasoningEffort: "minimal" | "low" | "medium" | "high"`, from `@askdb/ai`'s `reasoning.ts`) without weakening the BYO-model boundary this ADR establishes.

The key design question was where the portable-to-native `providerOptions` mapping should live, given `@askdb/core` never imports concrete provider packages and only knows `generateText`'s minimal call shape (§"What core actually needs from the AI SDK"). The mapping needs provider-specific knowledge (OpenAI/Azure `reasoningEffort`, Google `thinkingConfig.thinkingLevel` vs. `thinkingBudget` depending on the Gemini generation, Anthropic `thinking` budgets) plus a per-model capability check (never send reasoning options to a non-reasoning model), so it cannot live in core.

Resolution, consistent with Option F's adapter-owns-its-provider principle:

- `@askdb/ai-*` adapters implement an optional `resolveProviderOptions(config, { reasoningEffort })` on `AiProviderAdapter`, returning the provider's native `providerOptions` bag or `undefined` (unset effort, or a model that doesn't support reasoning tuning — e.g. `gpt-4o-mini`, `gemini-2.0-flash`).
- `AiRegistry` exposes `resolveProviderOptions(config, settings)`, dispatching to the resolved adapter.
- `@askdb/core` gained one new opaque field: `providerOptions?: Record<string, unknown>` on `AskGenerateDeps` / `GenerateSqlDeps` / `SuggestEnrichmentDeps`, forwarded verbatim into the existing `generateText({ ..., providerOptions })` call. Core still does not interpret, validate, or default this bag — it is exactly as BYO as the `model` parameter itself. Omitted (not sent as `{}`) when unset, so existing `generateText` call shapes are byte-for-byte unchanged.
- `@askdb/config`'s `ai.reasoning` block (`effort` / `nlToSql` / `enrichment`) flattens to `ASKDB_AI_REASONING_EFFORT[_NL_TO_SQL|_ENRICHMENT]` env vars, giving per-call-site defaults without adding a "call purpose" abstraction to `@askdb/core` itself — call-site distinction is a config/env-resolution concern (`@askdb/ai`'s `resolveReasoningEffort(env, purpose, override)`), not a pipeline concern.

Net effect: `ask()`'s public contract for reasoning tuning is "pass me a `providerOptions` bag," exactly mirroring "pass me a `LanguageModel`." Hosts that want AskDB's portable enum go through `@askdb/ai`; hosts that already hand-roll `providerOptions` (existing BYO users) are unaffected and can keep doing so directly.

**2026-09 — Moved from Option F to Option E (single `@askdb/ai`, lazily loaded built-in providers):** This amends the 2026-06-11 decision above. The four `@askdb/ai-*` packages (`@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`) are folded into `@askdb/ai` as built-in providers under `packages/ai/src/providers/`. The concrete AI SDK provider packages (`@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/anthropic`) become **optional peer dependencies** of `@askdb/ai`. Each built-in provider loads its SDK with a dynamic `import()` the first time it builds a model. If the SDK is not installed, model creation fails with an error naming the package to install. `ai@7`'s built-in Vercel AI Gateway provider is also registered as a built-in (`gateway`). It needs no extra package because `createGateway` ships with `ai`.

What stays the same:

- `@askdb/core` remains BYO-model and never depends on `@askdb/ai`. Passing an AI SDK `LanguageModel` straight to `ask()` is still a first-class path that needs no AskDB AI package at all.
- `AiProviderAdapter` is unchanged and remains the public extension point. Third-party adapters keep working unmodified: `createAiRegistry()` still accepts adapter objects, now alongside built-in provider names (`createAiRegistry(["openai"])`). Called with no arguments, it registers every built-in provider.
- Provider SDKs remain opt-in for library users. They are now optional peers of `@askdb/ai` (and of `@askdb/client`, which passes them through) instead of hard dependencies of separate packages. This follows the peer rule in #196's amendment: the floors are `^4.0.0`, the oldest release the contract tests pass against, so hosts on an older 4.x SDK can still install `@askdb/ai`.

What changes:

- The four `@askdb/ai-*` packages become deprecated re-export shims over `@askdb/ai` and will be removed before 1.0 (#347).
- Provider metadata (names, aliases, default models, native env vars, the SDK package, the setup hint) lives in one table exported from `@askdb/ai` (`BUILTIN_AI_PROVIDERS`). First-party surfaces derive their provider lists from it. `@askdb/config` keeps its own list because it must not depend on `@askdb/ai` at runtime, and a test in `@askdb/client`, which depends on both, asserts the two agree (ids, default models, and the env var names `flatten` writes).
- The batteries-included surfaces (`askdb`, `@askdb/http-api`, `@askdb/studio`) depend on `@askdb/ai` plus the four `@ai-sdk/*` packages directly and call `createAiRegistry()`.
- The consequence "adding a new provider is a new `@askdb/ai-*` package" is superseded. Adding a provider now means adding one file under `packages/ai/src/providers/`, one table row, and one optional peer.
- **Bundling.** Every import of `@askdb/ai` (and of `@askdb/client`) now reaches all built-in provider files, so the `import("@ai-sdk/<x>")` specifiers are visible to a host's bundler whichever provider it uses. Under Option F, a host that bundled `@askdb/client` with `@askdb/ai-openai` never saw the other SDKs. Each built-in writes `import("<sdk>").catch(rethrowMissingPeer(...))` so bundlers that honor that shape skip an SDK that isn't installed. Checked on 2026-09-29 against a host with only `@ai-sdk/openai@4.0.0` installed: esbuild 0.28 builds and runs, and the missing provider fails at runtime with the install message (the installable smoke test checks this). Vite 7 SSR with `ssr.noExternal: true` builds; a missing SDK then fails at runtime with Vite's own "Could not resolve" error. webpack 5 does **not** build: it reports `Module not found` for each missing `@ai-sdk/*` package, even with the `.catch()`. Such a host has to install all four SDKs or mark the missing ones as `externals` (checked: it then builds, and a missing SDK fails at runtime with the install message). This includes a host that changes nothing on upgrade: `@askdb/client` + `@askdb/ai-openai` from before this change bundles with webpack 5, and the same pair after it fails, because the shim re-exports from `@askdb/ai`'s main entry. Turbopack and Next.js were not checked, and `docs/platform.md` names Next.js as the web host.

Why:

- **The split saved nothing at the surfaces.** All three first-party surfaces registered all four adapters eagerly at module scope, so the `askdb` CLI loaded every provider SDK regardless of which one was configured. The per-provider install savings Option F promised only reached library users, and they still had to install two packages and import two symbols to say "use OpenAI."
- **The provider list drifted.** Providers were listed in nine or more places: each adapter, `@askdb/config`'s types, flatten logic, `ASKDB_AI_PROVIDERS`, and defaults, the CLI's `askdb init` lists, Studio's setup lists, and `aiKeyMissingMessage` / `aiProviderMissingMessage`. These lists had already disagreed. `ASKDB_AI_PROVIDERS` shipped without `anthropic`, `aiKeyMissingMessage` omitted Anthropic, and `askdb init` and Studio setup scaffolded `GOOGLE_GENERATIVE_AI_MODEL` while the Google adapter reads `GOOGLE_AI_MODEL`.
- **Release units (a minor reason).** Four extra packages released in near-lockstep added changelog and publishing noise without adding independence. The spurious majors they caused (each adapter peered `@askdb/ai`, and changesets bumps a peer dependent to a new major on every minor of the peer, so the adapters jumped from `0.1.0-beta.2` to `1.0.0-beta.3` with no breaking change) don't separate E from F: `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`, enabled in the same change, stops them under either layout.

Options considered for the fix:

- **Keep F unchanged.** Rejected: it leaves the eager loading at the surfaces and the drifting provider lists.
- **F with the table moved into `@askdb/ai` and lazy registration in the apps.** The apps would import `@askdb/ai-<x>` with `import()` only for the configured provider, and `@askdb/ai` would own the provider table. That fixes the eager loading and the drift. It keeps the two-install, two-import setup for library users ("use OpenAI" still needs `@askdb/ai-openai` plus its export), and five release units. It is clean, and it keeps static imports (and so bundling) exact. It lost because the library ergonomics were the main complaint and E removes the extra package without losing anything else F gave.
- **One package with per-provider subpath entries** (`@askdb/ai/openai`, `@askdb/ai/google`, …), each importing its SDK statically. Same install as E (`@askdb/client`, `@askdb/config`, `@ai-sdk/openai`) and no extra release units; the host adds one import line (`import { openaiProvider } from "@askdb/ai/openai"`) and passes it to `createAiRegistry([openaiProvider])` or `createAskDb({ providers: [openaiProvider] })`. Bundlers then see only the subpaths the host imports, so webpack works without configuration. What it gives up is zero-config selection by name: `createAiRegistry()` with no arguments and `createAskDb({ config })` without `providers` can only reach every provider through the lazy imports E uses. Adding subpaths later is not free. `registry.ts` imports the built-in table, so every `createAiRegistry` caller reaches all four `import("@ai-sdk/*")` sites, even one that passes only adapter objects; `@askdb/client` and the shims import the registry from the main entry. A webpack-clean path would need a registry entry that doesn't import the built-ins (e.g. `@askdb/ai/core`), the subpaths, and a second `@askdb/client` entry (or a client that takes the registry factory), because the main client entry registers every built-in by default. That is additive, but it is cheaper to decide before `createAskDb({ config })`'s all-built-ins default ships. Turbopack and Next.js are unmeasured. **Open: the maintainer decides between accepting the webpack cost (install the SDKs or use `externals`) and shipping subpaths plus a built-in-free registry entry now.**
- **E, as described above.** Chosen for this change; the subpath question above is still open.

The original Option E cons, and why they're acceptable now:

- *"A single `@askdb/ai` package can grow into a registry package."* It is one now, on purpose: the registry is a data table with one small file per provider, loaded lazily, so an unused provider costs a table row. The table stays limited to providers AskDB ships and tests; anything else plugs in through `AiProviderAdapter` without a change here.
- *"Provider-specific dependencies are still declared by the shared helper package."* They are declared as optional peers with wide floors, so they constrain a host only for SDKs it installs, and only to `^4.0.0`. The cost moves to AskDB: `@askdb/ai` has to keep working across each SDK's whole 4.x range. The contract tests are run against the floor versions before a floor changes (see the `new-ai-adapter` skill), and the `openai` provider sends `forceReasoning` so an older `@ai-sdk/openai` doesn't drop a reasoning effort for a model family it predates.
- The bundling consequence (above) is new since this ADR was written. It is the strongest argument for subpath entries, and the decision on them is left open for the maintainer.

This ADR's Option E analysis above already recorded the benefits now being adopted. The costs of Option F that were not visible when the decision was made, listed above, tipped the balance. Making `ai` a peer of `@askdb/core` (plan 035) is not part of this change; #196 lands it, in the next 2026-09 amendment below. Deferred: adopting `ai@7`'s portable top-level `reasoning` call option in place of per-provider `providerOptions` mapping, and deleting the shims.

**2026-09 — `ai` becomes a peer dependency of `@askdb/core` (`^6 || ^7`):** This amends the 2026-06-11 decision "Retain `ai` as a runtime dependency while core calls `generateText`" (and the matching Consequences bullet). `ai` moves from `@askdb/core`'s `dependencies` to a required `peerDependencies` entry with the range `^6.0.0 || ^7.0.51`; it stays in `devDependencies` (at `^7.0.51`) for building and testing core. The AI SDK 7 floor is the one ADR 0015 restored for every AskDB package; `^6.0.0` is the AI SDK 6 floor (see the floor check below).

Why the original reasoning no longer holds: calling `generateText` is a reason to *import* `ai`, not to *pin* it. Because `ask()` accepts a caller-constructed `LanguageModel`, the caller and core must agree on one `ai` instance; a hard dependency actively prevents that agreement across majors. The concrete evidence: a real integration runs `ai@^6` with `@ai-sdk/openai@^3` and is stuck on `@askdb/core@1.0.0-beta.40`, because `beta.41` moved core's dependency to `ai@^7`. Upgrading AskDB would force that host to migrate its whole AI stack — including AI features unrelated to AskDB — or to install two copies of `ai` whose `LanguageModel` / `generateText` types disagree. A peer dependency hands the version choice back to the host, which is where it belongs for a BYO-model library.

Why the range spans two majors rather than just `^7`: a `^7`-only peer would turn the AI SDK 6 host's silent duplicate into a hard `ERESOLVE`, which is worse. Core's AI SDK surface is small enough to support both:

- Core calls `generateText` with `system` rather than AI SDK 7's `instructions`. AI SDK 6 only reads `system` (it silently ignores `instructions`, so the NL→SQL system prompt was being dropped); AI SDK 7 still honors `system` as a deprecated alias (`instructions = system` in its prompt standardization). No dual-key or runtime version sniffing is needed.
- Usage parsing already tolerates both naming conventions (`promptTokens ?? inputTokens`).
- The published declarations only reference `LanguageModel` and `generateText` from `ai`, which exist in both majors; they resolve against the host's installed `ai`, which is the desired behavior (`AskDbLanguageModel` is exactly the host's `LanguageModel`).
- `examples/installable-smoke/consumer-ai6` installs the packed core tarball next to `ai@6` and `@ai-sdk/openai@3` and runs `ask()` through AI SDK 6 end to end.

The floor check: the AI SDK 7 floor (`^7.0.51`) is the one ADR 0015 restored, and the consumer lab pins its host at it. The AI SDK 6 floor (`^6.0.0`, and `^3.0.0` for `@askdb/rag`'s `@ai-sdk/openai` peer) is held by the installable smoke. Its `consumer-ai6` fixture is pinned to exactly `ai@6.0.0` and `@ai-sdk/openai@3.0.0`, and type-checks and runs `ask()` and the RAG embedder on every `pnpm smoke:install`. Because core and rag now accept two majors, ADR 0015's "one `ai` range" rule compares ranges per AI SDK major (its 2026-10 amendment).

`@askdb/rag`'s optional `ai` / `@ai-sdk/openai` peers were widened to the same majors for the same reason (`^6.0.0 || ^7.0.51` and `^3.0.0 || ^4.0.29`; its AI SDK embedder only needs `embedMany` and the `EmbeddingModel` type). `@askdb/ai`, `@askdb/client` and the deprecated `@askdb/ai-*` shims already declared `ai` as a peer and keep `^7.0.51`, because the config-driven path needs AI SDK 7; first-party apps (`askdb`, `@askdb/http-api`, `@askdb/studio`) keep `ai` as a direct dependency because they are batteries-included products, not libraries.

What is unchanged: core stays BYO-model, still exports `AskDbLanguageModel`, and still calls `generateText`. When AI SDK 8 ships, the whole upgrade is widening the peer range, after checking the call shape.

The rule going forward, and its scope: a library package declares anything a host could reasonably already have installed (`ai`, an `@ai-sdk/*` provider package, a database driver) as a peer, not a bundled dependency. Today the rule covers:

- `ai` in `@askdb/core`, `@askdb/rag`, `@askdb/ai` and `@askdb/client`;
- the four `@ai-sdk/*` provider packages (`openai`, `azure`, `google`, `anthropic`), optional peers of `@askdb/ai` and `@askdb/client` since the Option E amendment above;
- `@ai-sdk/openai` in `@askdb/rag`;
- the database drivers of the engine packages (`pg`, `mysql2`, `better-sqlite3`, `mssql`) and `pg` in `@askdb/rag`.

All of these already comply. The rule also covers any library package that adds `@ai-sdk/*` or driver code from now on. Named exception: the deprecated `@askdb/ai-*` compatibility shims that the adapter collapse (#227, the Option E amendment above) left behind keep their `@ai-sdk/*` provider in `dependencies`, so existing installs don't break. The exception ends when those packages are removed (tracked by #347). First-party apps (`askdb`, `@askdb/http-api`, `@askdb/studio`) are products, not libraries, and the rule doesn't apply to them.

**Required peer, not optional (decided 2026-09, #196).** Core imports `generateText` from `ai` at module load (`sql/generate.ts`, `enrichment/suggest.ts`, both re-exported from the root entry). So every package that imports a runtime value from `@askdb/core` needs `ai` installed, even when it never generates SQL: `@askdb/introspect` (for `parseTableMarkdown`) and through it `@askdb/connectors` and `@askdb/prisma`, the engine packages (dialect specs, `AskDbError`), `@askdb/rag` and `@askdb/enrich`. These packages do need core at runtime, not only its types, but only its Schema v2 contract, dialect specs and errors, never its generation layer. npm 7+ and pnpm (with the default `auto-install-peers`) install a missing required peer. Yarn (classic and Berry), `npm --legacy-peer-deps` and pnpm with `auto-install-peers=false` don't, and there an introspection-only install fails at import with `ERR_MODULE_NOT_FOUND: Cannot find package 'ai'`. The options considered:

- **(a) Required peer (chosen).** npm and pnpm install `ai` for every core install, and Yarn warns at install time. The cost is that introspection-only installs carry `ai`. Every documented install line for a package that depends on core therefore includes `ai`.
- **(b) Optional peer (`peerDependenciesMeta`) with a lazy `import("ai")` inside `generateSelectSql()` / `suggestEnrichment()`.** This is the pattern `@askdb/rag` uses for `embedMany`. The runtime change is small: a prototype changed 4 lines, and a packed core then imported cleanly without `ai`, failing only when generation was called. It doesn't keep the types sound, though. The published `.d.ts` still import `LanguageModel` and `generateText` from `ai`. A TypeScript consumer without `ai` gets 5 `TS2307: Cannot find module 'ai'` errors under `skipLibCheck: false`, even when it imports only `parseTableMarkdown` or `POSTGRES_DIALECT`. Under `skipLibCheck: true`, `AskDbLanguageModel` silently becomes `any`. npm and pnpm would also stop installing `ai` for generation users who forget it, which moves the failure from install time to the first `ask()` call. Removing `ai` from the declarations would mean replacing `AskDbLanguageModel` (today exactly the host's `LanguageModel`) with a local structural type, which is a public-type change.
- **(c) Split the generation entry point.** Give the schema/dialect layer an entry point whose JS and `.d.ts` never reach `ai`, and move `@askdb/introspect`, the engine packages, `@askdb/rag` and `@askdb/enrich` to it. This is the clean fix for introspection-only installs. It is a package-surface restructure across core and its dependents, too large for #196. It is tracked, with a separate-package alternative, as a maintainer decision in #370.

Decision: (a). If #370 lands an `ai`-free entry point, revisit whether the peer can become optional. Until then, don't switch to (b) on its own: without (c) it trades an install-time warning for broken or `any` types.
