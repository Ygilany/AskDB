# ADR 0006 - AI provider integration strategy

## Status

Proposed.

## Context

`@askdb/core` is the central dialect-agnostic NL-to-SQL pipeline. It currently depends on the
Vercel AI SDK core package (`ai`) and concrete provider packages (`@ai-sdk/openai`,
`@ai-sdk/azure`, `@ai-sdk/google`). The pipeline API is already mostly correct: callers pass a
model into `ask()`, and core does not read `process.env` or choose a provider during a request.

The problem is where the convenience provider construction lives. `@askdb/core` exports helpers
such as `resolveAskDbAiConfig`, `createAskDbLanguageModelFromEnv`,
`resolveAskDbEmbeddingConfig`, and `createAskDbEmbeddingModelFromEnv`. Those helpers construct
OpenAI, Azure, and Google models from config/env maps, so every `@askdb/core` consumer installs
the provider packages even when they only use one provider, provide their own AI SDK model, or do
not use the env-based helpers at all.

This violates the package boundary from ADR 0002: core should own the pipeline, schema types,
prompt assembly, SQL validation, tenant policy, logging contracts, retrieval input, and dialect
orchestration. Provider bootstrap is integration/bootstrap code.

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

AskDB core does not use streaming, tool calling, image input, provider registries, or structured
generation for the NL-to-SQL path. The model is only passed to `generateText`; core never
constructs or inspects provider instances.

The AI SDK's `LanguageModel` contract remains a reasonable public seam for AskDB because it is
already provider-neutral and supports AI SDK custom providers. AskDB does not need to define a
smaller inference interface merely to enable custom providers.

## Considered Options

### Option A - Keep the current mixed core package

Keep `LanguageModel` from `ai` as the `ask()` contract. Keep all provider construction helpers in
`@askdb/core`. Keep `@ai-sdk/openai`, `@ai-sdk/azure`, and `@ai-sdk/google` as hard dependencies
of core.

Pros:

- No migration cost.
- First-party apps keep their current imports.

Cons:

- Every core consumer pays for all bundled provider packages.
- Adding provider support requires changing core.
- Core owns bootstrap concerns outside its stated responsibility.
- The package layout is inconsistent with database driver packages, which already use optional
  peer dependencies at integration boundaries.

### Option B - Pure BYO model only

Remove provider construction helpers from core and do not replace them. Integrators construct an
AI SDK model themselves before calling `ask()`.

Pros:

- Cleanest `@askdb/core` dependency graph.
- Strongest dependency inversion: core only depends on the model contract.

Cons:

- First-party apps still need a shared home for provider/env resolution.
- Users who want AskDB's config-driven provider selection would copy provider wiring into their
  apps.
- `@askdb/config` would describe provider branches with no corresponding convenience model
  factory.

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

Keep the AI SDK `LanguageModel` contract for `ask()`. Remove concrete provider packages and
provider construction helpers from `@askdb/core`. Create `@askdb/ai` as the home for AskDB's
config/env-to-model helpers.

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

Create a small `@askdb/ai` package for shared types/registry helpers and provider packages such
as `@askdb/ai-openai`, `@askdb/ai-azure`, and `@askdb/ai-google`.

Pros:

- Most granular provider dependency graph.
- Each provider is independently installable and versionable.
- Provider-specific options stay close to the provider implementation.

Cons:

- More packages to publish, document, and version.
- First-party apps would need more explicit dependency wiring immediately.

## Decision

Adopt Option F: extract provider construction out of `@askdb/core`, keep `@askdb/core`
BYO-model, make `@askdb/ai` the shared registry/config package, and publish provider-specific
packages for the concrete provider factories.

### `@askdb/core`

- Remove `@ai-sdk/openai`, `@ai-sdk/azure`, and `@ai-sdk/google` from runtime dependencies.
- Retain `ai` as a runtime dependency while core calls `generateText`.
- Export an AskDB-owned name for the AI SDK model contract:

  ```ts
  export type { LanguageModel as AskDbLanguageModel } from "ai";
  ```

- Change public core types from `LanguageModel` to `AskDbLanguageModel`. This is a source-level
  naming change, not a behavioral change: callers can continue passing any AI SDK language model.
- Remove provider construction helpers from the core root export:
  - `resolveAskDbAiConfig`
  - `resolveAskDbEmbeddingConfig`
  - `createAskDbLanguageModel`
  - `createAskDbLanguageModelFromEnv`
  - `createAskDbEmbeddingModel`
  - `createAskDbEmbeddingModelFromEnv`
  - `askDbAiKeyMissingMessage`

Core should not re-export these helpers from `@askdb/ai`. A compatibility re-export would pull the
new integration package back into core and weaken the dependency boundary. Because AskDB is still
pre-1.0/beta, the import-path change is an acceptable breaking change when documented clearly.

### `@askdb/ai`

Create a workspace package for AskDB's shared AI config and provider registry.

`@askdb/ai` owns:

- Provider/env resolution types such as `AskDbAiProvider`, `AskDbAiConfig`, and `AskDbAiEnv`.
- `resolveAskDbAiConfig`.
- `resolveAskDbEmbeddingConfig`.
- Provider adapter types such as `AskDbAiProviderAdapter`.
- `createAskDbAiRegistry`.
- `askDbAiKeyMissingMessage`.
- `askDbAiProviderMissingMessage`.

Dependency model:

- `ai`: hard dependency, because registry methods return AI SDK model types.
- No concrete AI SDK provider packages.

### Provider Packages

Create provider-specific packages:

- `@askdb/ai-openai` depends on `@ai-sdk/openai` and exports `openaiProvider`.
- `@askdb/ai-azure` depends on `@ai-sdk/azure` and exports `azureProvider`.
- `@askdb/ai-google` depends on `@ai-sdk/google` and exports `googleProvider`.

First-party apps install and register the provider adapters they intentionally support. Library
users install only the adapter packages they need.

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

Users who want AskDB's env/config provider resolution install `@askdb/ai` plus the provider
adapter package they use:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAskDbAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { ask } from "@askdb/core";

const ai = createAskDbAiRegistry([openaiProvider]);

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
import { createAskDbAiRegistry } from "@askdb/ai";
import { azureProvider } from "@askdb/ai-azure";
import { googleProvider } from "@askdb/ai-google";
import { openaiProvider } from "@askdb/ai-openai";
import { ask } from "@askdb/core";

const ai = createAskDbAiRegistry([openaiProvider, azureProvider, googleProvider]);
```

Apps declare the provider packages they intentionally support as direct dependencies.

## Consequences

- `@askdb/core` loses hard dependencies on concrete AI SDK provider packages.
- `@askdb/core` keeps a dependency on `ai` while it uses `generateText`.
- Provider construction becomes an integration-layer concern in `@askdb/ai-*` packages.
- `@askdb/ai` owns config resolution and registry dispatch only.
- First-party apps and docs update provider-helper imports from `@askdb/core` to `@askdb/ai`
  plus the provider adapter packages.
- Consumers who import provider helpers from `@askdb/core` must update to `@askdb/ai` registry
  usage.
- `@askdb/rag` keeps its current optional peer dependency pattern for `ai`, `@ai-sdk/openai`,
  and `pg`. It should not rely on transitive availability of `ai`; any public type or runtime
  helper that uses AI SDK embedding models must continue declaring the relevant peer dependency.
- Adding a new provider no longer requires changing `@askdb/core`.
- Adding a new provider is a new `@askdb/ai-*` package plus a config branch when AskDB wants to
  support it through config/env resolution.

## Related

- ADR 0002 - Integration-package layout.
- ADR 0005 - AskDB config package and env bootstrap.
- `packages/core/src/sql/generate.ts` - current AI SDK runtime call site in core.
- `packages/ai/src/provider.ts` - shared config resolution and provider registry.
- AI SDK providers and models: <https://ai-sdk.dev/docs/foundations/providers-and-models>.
- AI SDK provider management: <https://ai-sdk.dev/docs/ai-sdk-core/provider-management>.
