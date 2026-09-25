---
name: new-ai-adapter
description: Add a new built-in AI provider to @askdb/ai from any Vercel AI SDK provider package (one provider file, one table row, one optional peer, tests, config branch, docs, changeset). Use when asked to add an AI provider such as Mistral, Cohere, xAI, DeepSeek, or another @ai-sdk/* package.
---

# New AskDB built-in AI provider

You are adding a built-in provider to `@askdb/ai` in the AskDB pnpm monorepo. Since the ADR 0006
amendment (Option E), providers are **not** separate packages: each is one file in
`packages/ai/src/providers/`, one row in the built-in table, and one **optional peer
dependency** that is loaded lazily. Do **not** create a `packages/ai-<provider>` package — the
four `@askdb/ai-*` packages that still exist are deprecated re-export shims scheduled for removal.

This skill is self-contained: follow it top to bottom, run every verification command, and stop
at any STOP condition instead of improvising.

## Inputs (resolve these first)

From the user's request, determine — ask only for what cannot be inferred:

1. **`<provider>`** — lowercase id: the `ASKDB_AI_PROVIDER` / `ai.provider` value and
   `adapter.provider` (e.g. `mistral`, `cohere`, `xai`).
2. **`<sdk>`** — the AI SDK package, normally `@ai-sdk/<provider>`. Confirm it exists:
   `npm view @ai-sdk/<provider> version`. Confirm its factory API:
   `npm view @ai-sdk/<provider> readme | head -100` — you need the `create<X>` factory
   name (e.g. `createMistral`) and whether it exposes `.embedding()` / `.embeddingModel()` or
   has no embeddings at all. If the factory ships inside `ai` itself (as `createGateway` does),
   there is no peer package: see `providers/gateway.ts`.
3. **Native env vars** — the provider's conventional key/model/baseURL variables (e.g.
   `MISTRAL_API_KEY`). Use the names the SDK's own docs use; never invent new ones.
4. **`<defaultModel>`** — a current, real chat model id for the provider. Verify against
   the provider's docs (WebFetch/WebSearch if available); do not trust memory for model
   ids. For Anthropic specifically, consult the `claude-api` skill if available.
5. **Aliases** — alternative `ASKDB_AI_PROVIDER` spellings users may try (often none).

## Prerequisites — verify before starting

```bash
grep -n "BUILTIN_AI_PROVIDERS" packages/ai/src/providers/index.ts   # must match
grep -n "importOptionalPeer" packages/ai/src/providers/optional-peer.ts   # must match
```

**STOP if either grep is empty** — the codebase predates the built-in provider table (ADR 0006
amendment, 2026-09); report that instead of scaffolding a package.

Repo facts you can rely on:

- pnpm workspace; build/lint/test per package via `tsc` and vitest. Root gates: `pnpm build`,
  `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm docs:build`.
- Releases use changesets: create a `.changeset/<slug>.md` file by hand (copy the format of any
  existing file there).
- Conventional commits (`feat(ai): …`).
- Reference providers to diff against: `packages/ai/src/providers/anthropic.ts` (no
  embeddings) and `packages/ai/src/providers/google.ts` (embeddings + reasoning mapping).

## Step 1 — Provider file

Create `packages/ai/src/providers/<provider>.ts`, following this template:

```ts
import { withEmbeddingProviderOptions } from "../embedding.js";
import { resolveBaseConfig, type AiConfig, type AiProviderAdapter } from "../provider.js";
import { importOptionalPeer } from "./optional-peer.js";
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
  // Literal specifier inside the function: lazy, bundler-visible, and no top-level await
  // (a top-level await would break require('@askdb/ai') from CommonJS).
  const { create<X> } = await importOptionalPeer("<provider>", PEER_PACKAGE, () => import("<sdk>"));
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

- Provider-specific connection settings beyond apiKey/baseURL/model (an Azure-style resource
  name, region, project id) go into `config.providerOptions` inside a custom `resolveConfig`
  wrapper around `resolveBaseConfig`, never as new `AiConfig` fields — see
  `packages/ai/src/providers/azure.ts`, including validation that throws a clear message when a
  required setting is missing.
- Auth that is not an API key (OAuth, SigV4/AWS credentials): **STOP and report** —
  `AiConfig.apiKey` is required by contract and the no-key-means-disabled rule; that contract
  change needs its own design pass.

## Step 2 — Register it

1. Add `<provider>Builtin` to `BUILTIN_AI_PROVIDERS` in `packages/ai/src/providers/index.ts`
   (display order: append unless told otherwise) and re-export `<provider>Provider` there and
   from `packages/ai/src/index.ts`.
2. In `packages/ai/package.json`, add `<sdk>` to `peerDependencies` **and**
   `peerDependenciesMeta` (`{ "optional": true }`) and to `devDependencies`, using the same
   major range style as the other `@ai-sdk/*` entries.
3. Add `<sdk>` to `dependencies` of the batteries-included surfaces: `apps/cli`,
   `apps/http-api`, `apps/studio`. No code changes there — they call `createAiRegistry()`,
   which registers every built-in.

## Step 3 — Tests

- `packages/ai/src/providers/<provider>.test.ts`, modeled on `anthropic.test.ts`
  (`vi.hoisted` + `vi.mock("<sdk>")`; the mock also intercepts the dynamic import). Required
  cases: provider id; language-model construction passes apiKey and baseURL (remember to
  `await` the factory); embeddings (construction with forwarded options, or the throw with a
  message containing "embeddings"); `resolveConfig` resolves the native key var; default model
  applied; returns `undefined` when no key is configured.
- `packages/ai/src/providers/<provider>.contract.test.ts`, modeled on
  `openai.contract.test.ts`: the **real** SDK with `vi.stubGlobal("fetch")`, asserting the
  HTTP body carries the model id and any provider options you emit.
- Update the expectations in `packages/ai/src/registry.test.ts` (built-in names/order, peer
  table, setup helpers) and `packages/ai/src/provider.test.ts` (`aiKeyMissingMessage`).

**Verify**: `pnpm install && pnpm --filter @askdb/ai build && pnpm --filter @askdb/ai test` → exit 0.

## Step 4 — Config branch (required for built-ins)

`packages/ai/src/providers/config-drift.test.ts` fails until `@askdb/config` knows the provider.
`@askdb/config` must not depend on `@askdb/ai`, so mirror it there:

- `src/constants.ts`: append `<provider>` to `ASKDB_AI_PROVIDERS`.
- `src/defaults.ts` (+ export from `src/index.ts`): `DEFAULT_<PROVIDER>_CHAT_MODEL`, equal to
  `ENV_SPEC.defaultModel`; add it to the drift test's defaults map.
- `src/types.ts`: a `<Provider>Config` type, add it to `AiProviderConfigs`, a
  `<Provider>AiConfig` branch, and the `AskDbAiConfig` union (export both from `src/index.ts`).
- `src/flatten.ts`: an `apply<Provider>Ai()` writing the native env keys plus `ASKDB_AI_MODEL`,
  and a branch using `requireProviderBranch`.
- `src/config.test.ts`: flatten tests for the new branch; update the `ASKDB_AI_PROVIDERS` list
  test.

Also add the provider to Studio's browser-side list in
`apps/studio/src/web/views/setup/types.ts` (`AI_PROVIDERS`, `SetupAiProvider`) and to
`PROVIDER_WIRING` in `apps/studio/src/web/views/playground/GetTheCodePanel.tsx`;
`apps/studio/src/setup-providers.test.ts` fails until the setup list matches. `askdb init`
derives its choices from the table and needs no change.

**Verify**: `pnpm build && pnpm lint && pnpm test` → exit 0.

## Step 5 — Docs

- `docs/integration/installable-package.md`: add a provider recipe section (env form +
  `askdb.config.ts` form), formatted like the existing provider sections.
- `packages/ai/README.md`: add the provider to the built-in provider table.
- Docs site: `apps/docs-site/src/content/docs/reference/packages.mdx` (provider install tabs)
  and `reference/config.mdx` (env-var table) — match surrounding formatting.

**Verify**: `pnpm docs:build` → exit 0.

## Step 6 — Changeset and final gate

Create `.changeset/add-<provider>-provider.md`: minor for `@askdb/ai` and `@askdb/config`,
patch for `askdb`, `@askdb/http-api`, `@askdb/studio` (new dependency). State the env vars, the
default model, the peer package to install, and the config branch. Run
`pnpm changeset status` and confirm no package is planned for a major bump.

**Final gate (all must pass):**

```bash
pnpm build && pnpm lint && pnpm test
pnpm smoke:install
pnpm docs:build
git status   # only intended files changed
```

## STOP conditions

- `@ai-sdk/<provider>` doesn't exist, is unmaintained, or its major version differs from
  the `@ai-sdk/*` majors already in the repo — report options instead of pinning blind.
- The SDK factory doesn't follow the `create<X>(settings)(modelId)` shape.
- Auth is not API-key based (see Step 1).
- The prerequisite greps fail.
- Any final-gate command fails twice after a reasonable fix attempt.
