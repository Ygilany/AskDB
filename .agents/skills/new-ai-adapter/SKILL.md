---
name: new-ai-adapter
description: Add a new built-in AI provider to @askdb/ai from any Vercel AI SDK provider package (one provider file, one table row, one optional peer, tests, config branch, docs, changeset). Use when asked to add an AI provider such as Mistral, Cohere, xAI, DeepSeek, or another @ai-sdk/* package.
---

# New AskDB built-in AI provider

You are adding a built-in provider to `@askdb/ai` in the AskDB pnpm monorepo. Since the ADR 0006 amendment (Option E), providers are **not** separate packages: each is one file in `packages/ai/src/providers/`, one row in the built-in table, and one **optional peer dependency** that is loaded lazily. Do **not** create a `packages/ai-<provider>` package — the four `@askdb/ai-*` packages that still exist are deprecated re-export shims scheduled for removal.

This skill is self-contained: follow it top to bottom, run every verification command, and stop at any STOP condition instead of improvising.

## Inputs (resolve these first)

From the user's request, determine — ask only for what cannot be inferred:

1. **`<provider>`** — lowercase id: the `ASKDB_AI_PROVIDER` / `ai.provider` value and `adapter.provider` (e.g. `mistral`, `cohere`, `xai`).
2. **`<sdk>`** — the AI SDK package, normally `@ai-sdk/<provider>`. Confirm it exists: `npm view @ai-sdk/<provider> version`. Confirm its factory API: `npm view @ai-sdk/<provider> readme | head -100` — you need the `create<X>` factory name (e.g. `createMistral`) and whether it exposes `.embedding()` / `.embeddingModel()` or has no embeddings at all. If the factory ships inside `ai` itself (as `createGateway` does), there is no peer package: see `providers/gateway.ts`.
3. **Native env vars** — the provider's conventional key/model/baseURL variables (e.g. `MISTRAL_API_KEY`). Use the names the SDK's own docs use; never invent new ones.
4. **`<defaultModel>`** — a current, real chat model id for the provider. Verify against the provider's docs (WebFetch/WebSearch if available); do not trust memory for model ids. For Anthropic specifically, consult the `claude-api` skill if available.
5. **Aliases** — alternative `ASKDB_AI_PROVIDER` spellings users may try (often none).

## Prerequisites — verify before starting

```bash
grep -n "BUILTIN_AI_PROVIDERS" packages/ai/src/providers/index.ts   # must match
grep -n "rethrowMissingPeer" packages/ai/src/providers/optional-peer.ts   # must match
```

**STOP if either grep is empty** — the codebase predates the built-in provider table (ADR 0006 amendment, 2026-09); report that instead of scaffolding a package.

Repo facts you can rely on:

- pnpm workspace; build/lint/test per package via `tsc` and vitest. Root gates: `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm docs:build`.
- Releases use changesets: create a `.changeset/<slug>.md` file by hand (copy the format of any existing file there).
- Conventional commits (`feat(ai): …`).
- Reference providers to diff against: `packages/ai/src/providers/anthropic.ts` (no embeddings) and `packages/ai/src/providers/google.ts` (embeddings + reasoning mapping).

## Step 1 — Provider file

Create `packages/ai/src/providers/<provider>.ts`, following this template:

```ts
import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import { rethrowMissingPeer } from "./optional-peer.js";
import type { BuiltinAiProvider, BuiltinProviderEnvSpec } from "./types.js";

const PEER_PACKAGE = "<sdk>";

const ENV_SPEC: BuiltinProviderEnvSpec = {
  apiKeyVars: ["<PROVIDER>_API_KEY"],
  modelVars: ["<PROVIDER>_MODEL"],          // only if a native convention exists
  embeddingModelVars: ["<PROVIDER>_EMBEDDING_MODEL"], // only if embeddings exist
  baseURLVars: ["<PROVIDER>_BASE_URL"],
  defaultModel: "<defaultModel>",
  // defaultEmbeddingModel only when the provider has a sensible default
};

const CONFIG_HINT =
  "For <ProviderName>, set ai.provider: \"<provider>\" and ai.providerConfig.<provider>.apiKey in askdb.config.*.";

async function createProvider(config: AiConfig) {
  // Literal specifier inside the function: lazy, and no top-level await (a top-level await
  // would break require('@askdb/ai') from CommonJS). Keep `.catch()` chained on the
  // `import()` itself: that is how esbuild and other bundlers tell an optional import from a
  // required one. Wrapping it as `() => import(...)` in a helper makes every host's bundle
  // fail unless this SDK is installed (the installable smoke test's esbuild step checks this).
  const { create<X> } = await import("<sdk>").catch(rethrowMissingPeer("<provider>", PEER_PACKAGE));
  return create<X>({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

export const <provider>Provider: AiProviderAdapter = {
  provider: "<provider>",
  // aliases: ["..."],  // only if real alternative spellings exist
  configHint: CONFIG_HINT,
  resolveConfig(env, options) {
    return resolveBaseConfig("<provider>", env, ENV_SPEC, options);
  },
  async createLanguageModel(config) {
    return (await createProvider(config))(config.model);
  },
  async createEmbeddingModel(config, options = {}) {
    // If the SDK has embeddings: build the model, then forward options under the key the
    // SDK actually reads (verify it in the SDK source — see the contract tests):
    // const model = (await createProvider(config)).embedding(config.model);
    // return withEmbeddingProviderOptions(model, "<provider>", options);
    // If the SDK names the settings differently, pass a mapper, as google.ts does:
    // withEmbeddingProviderOptions(model, "google", options, ({ dimensions }) => ({ outputDimensionality: dimensions }))
    // If the provider has NO embeddings API, make this a plain (non-async) method that throws:
    throw new Error(
      "<ProviderName> does not provide an embeddings API. Configure a different " +
        "embedding provider while using <ProviderName> for chat.",
    );
  },
  // resolveProviderOptions(config, { reasoningEffort }) — only if the provider has a
  // reasoning knob; return undefined for models that don't support it.
};

export const <provider>Builtin: BuiltinAiProvider = {
  provider: "<provider>",
  label: "<ProviderName>",
  aliases: [],
  peerPackage: PEER_PACKAGE,
  env: ENV_SPEC,
  embeddings: false, // true if createEmbeddingModel builds a model
  configHint: CONFIG_HINT,
  adapter: <provider>Provider,
};
```

Rules:

- Provider-specific connection settings beyond apiKey/baseURL/model (an Azure-style resource name, region, project id) go into `config.providerOptions` inside a custom `resolveConfig` wrapper around `resolveBaseConfig`, never as new `AiConfig` fields — see `packages/ai/src/providers/azure.ts`, including validation that throws a clear message when a required setting is missing.
- Auth that is not an API key (OAuth, SigV4/AWS credentials): **STOP and report** — `AiConfig.apiKey` is required by contract and the no-key-means-disabled rule; that contract change needs its own design pass.

## Step 2 — Register it

1. Add `<provider>Builtin` to `BUILTIN_AI_PROVIDERS` in `packages/ai/src/providers/index.ts` (display order: append unless told otherwise) and re-export `<provider>Provider` there and from `packages/ai/src/index.ts`.
2. In `packages/ai/package.json` **and** `packages/client/package.json`, add `<sdk>` to `peerDependencies` and `peerDependenciesMeta` (`{ "optional": true }`). `@askdb/client` re-declares the optional peers so strict installs (Yarn PnP) can pass them through to `@askdb/ai`. The peer floor is the oldest `<sdk>` version the contract tests pass against, not the latest. A floor that's too high is a hard `ERESOLVE` for hosts on an older SDK. `pnpm test:ai-floors` (also run by CI and `pnpm preflight`) installs every peer at its `^` floor in a scratch project and runs the `@askdb/ai` tests there; run it after Step 3 and raise the floor only if it fails for a reason you can't fix in the provider.
3. Add `<sdk>` to `dependencies` of the batteries-included surfaces: `apps/cli`, `apps/http-api`, `apps/studio`. No code changes there — they call `createAiRegistry()`, which registers every built-in.
4. If the Vercel AI Gateway serves this provider's models under a `<provider>/` prefix and the provider has reasoning or embedding options, add it to `UPSTREAM_ADAPTERS` in `packages/ai/src/providers/gateway.ts` (and to the gateway's embedding mapping if its embedding option names differ).

## Step 3 — Tests

- `packages/ai/src/providers/<provider>.test.ts`, modeled on `anthropic.test.ts` (pure functions, no SDK mocks). Required cases: `resolveConfig` resolves the native key var; default model applied; returns `undefined` when no key is configured; any `resolveProviderOptions` mapping.
- `packages/ai/src/providers/<provider>.contract.test.ts`, modeled on `openai.contract.test.ts`: the **real** SDK with `vi.stubGlobal("fetch")`, asserting the request URL and HTTP body carry the model id, a configured `baseURL`, any provider options you emit, and embedding options (or the throw with a message containing "embeddings"). Don't mock the `@ai-sdk/*` package — a mock echoes its input and can't see what the SDK actually sends.
- Update the expectations in `packages/ai/src/registry.test.ts` (built-in names/order, peer table, setup helpers) and `packages/ai/src/provider.test.ts` (`aiKeyMissingMessage`).
- The installable smoke test (`examples/installable-smoke/run.sh`) loads every row of `BUILTIN_AI_PROVIDERS` in the app sandbox, so it needs no edit; it fails if the apps don't depend on `<sdk>`.

**Verify**: `pnpm install && pnpm --filter @askdb/ai build && pnpm --filter @askdb/ai test` → exit 0.

## Step 4 — Config branch (required for built-ins)

`packages/client/src/provider-config-drift.test.ts` fails until `@askdb/config` knows the provider: it flattens every config branch and resolves it through the registry, so the id list, env var names, and default model must all agree. `@askdb/config` must not depend on `@askdb/ai`, so mirror it there:

- `src/constants.ts`: append `<provider>` to `ASKDB_AI_PROVIDERS`.
- `src/defaults.ts` (+ export from `src/index.ts`): `DEFAULT_<PROVIDER>_CHAT_MODEL`, equal to `ENV_SPEC.defaultModel`.
- `src/types.ts`: a `<Provider>Config` type, add it to `AiProviderConfigs`, a `<Provider>AiConfig` branch, and the `AskDbAiConfig` union (export both from `src/index.ts`).
- `src/flatten.ts`: an `apply<Provider>Ai()` writing env keys the provider reads (`apiKeyVars[0]`, a `baseURLVars` entry) plus `ASKDB_AI_MODEL`, and a branch using `requireProviderBranch`.
- `src/config.test.ts`: flatten tests for the new branch; update the `ASKDB_AI_PROVIDERS` list test.
- `src/scaffold.ts`: if the provider can't start without a setting beyond the API key and model (as Azure needs `resourceName`), add it to `renderAskDbAiConfigScaffold`. `askdb init` and Studio's setup wizard both render the `ai` block through it, so this is the only place to change.

Hand-maintained lists outside `@askdb/ai` and `@askdb/config` (everything else derives from `BUILTIN_AI_PROVIDERS` or `ASKDB_AI_PROVIDERS`):

- `apps/studio/src/web/views/setup/types.ts` (`AI_PROVIDERS`, `SetupAiProvider`): Studio's browser bundle can't import `@askdb/ai`. `apps/studio/src/setup-providers.test.ts` fails until it matches.
- `PROVIDER_WIRING` in `apps/studio/src/web/views/playground/GetTheCodePanel.tsx`: the "Get the code" snippet.

These derive and need no change: `askdb init`'s choices, validation, and `--help` (`apps/cli/src/init.ts`, `apps/cli/src/cli.ts`), Studio's server-side setup (`apps/studio/src/setup.ts`) and its request type (`apps/studio/src/shared/api.ts`), and the smoke test's provider loop.

**Verify**: `pnpm build && pnpm lint && pnpm test` → exit 0.

## Step 5 — Docs

- `docs/integration/installable-package.md`: add a provider recipe section (env form + `askdb.config.ts` form), formatted like the existing provider sections.
- `packages/ai/README.md`: add the provider to the built-in provider table.
- Find every page that lists the built-ins and add the provider there: `git grep -n -i "anthropic" apps/docs-site/src apps/docs-site/public docs/architecture.md docs/integration`. When `gateway` was added, that meant:
  - `guides/bring-your-own-model.mdx`: the config tab and the direct-model tab;
  - `reference/cli.mdx`: the `--ai-provider` values;
  - `reference/client-api.mdx`: the default list for `providers`;
  - `reference/config.mdx`: the env-var table, the list of built-ins, and the reasoning mapping sentence;
  - `reference/packages.mdx`: the install tabs and the other provider mentions;
  - `apps/docs-site/public/AGENTS.md` and `docs/architecture.md`.
  Match the surrounding formatting.

**Verify**: `pnpm docs:build` → exit 0.

## Step 6 — Changeset and final gate

Create `.changeset/add-<provider>-provider.md`: minor for `@askdb/ai` and `@askdb/config`, patch for `askdb`, `@askdb/http-api`, `@askdb/studio` (new dependency). State the env vars, the default model, the peer package to install, and the config branch. Run `pnpm changeset status` and confirm no package is planned for a major bump.

**Final gate (all must pass):**

```bash
pnpm build && pnpm lint && pnpm test
pnpm smoke:install
pnpm docs:build
git status   # only intended files changed
```

## STOP conditions

- `@ai-sdk/<provider>` doesn't exist, is unmaintained, or its major version differs from the `@ai-sdk/*` majors already in the repo — report options instead of pinning blind.
- The SDK factory doesn't follow the `create<X>(settings)(modelId)` shape.
- Auth is not API-key based (see Step 1).
- The prerequisite greps fail.
- Any final-gate command fails twice after a reasonable fix attempt.
