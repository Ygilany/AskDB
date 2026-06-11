---
name: new-ai-adapter
description: Scaffold a new @askdb/ai-<provider> adapter package from any Vercel AI SDK provider and wire it into the AskDB monorepo (surfaces, config, smoke test, docs, changeset). Use when asked to add an AI provider such as Mistral, Cohere, xAI, DeepSeek, or another @ai-sdk/* package.
---

# New AskDB AI provider adapter

You are scaffolding `@askdb/ai-<provider>` in the AskDB pnpm monorepo. This skill is
self-contained: follow it top to bottom, run every verification command, and stop at any
STOP condition instead of improvising.

## Inputs (resolve these first)

From the user's request, determine — ask only for what cannot be inferred:

1. **`<provider>`** — lowercase id, becomes the package suffix, the `ASKDB_AI_PROVIDER`
   value, and `adapter.provider` (e.g. `mistral`, `cohere`, `xai`).
2. **`<sdk>`** — the AI SDK package, normally `@ai-sdk/<provider>`. Confirm it exists:
   `npm view @ai-sdk/<provider> version`. Confirm its factory API:
   `npm view @ai-sdk/<provider> readme | head -100` — you need the `create<X>` factory
   name (e.g. `createMistral`) and whether it exposes `.textEmbeddingModel()` /
   `.embedding()` or has no embeddings at all.
3. **Native env vars** — the provider's conventional key/model/baseURL variables (e.g.
   `MISTRAL_API_KEY`). Use the names the SDK's own docs use; never invent new ones.
4. **`<defaultModel>`** — a current, real chat model id for the provider. Verify against
   the provider's docs (WebFetch/WebSearch if available); do not trust memory for model
   ids. For Anthropic specifically, consult the `claude-api` skill if available.
5. **Aliases** — alternative `ASKDB_AI_PROVIDER` spellings users may try (often none).

## Prerequisites — verify before scaffolding

This skill targets the post-adapter-contract-v2 architecture (plans 001/004 in `plans/`):

```bash
grep -n "resolveBaseConfig" packages/ai/src/provider.ts   # must match
grep -n "configHint" packages/ai/src/provider.ts          # must match
```

**STOP if either grep is empty** — the open adapter contract is not merged yet; report
that plans/001 (and 004 for `configHint`) must land first.

Repo facts you can rely on:

- pnpm workspace; build/lint/test per package via `tsc` and vitest
  (`"test": "vitest run --config ../../vitest.config.ts"`). Root gates: `pnpm build`,
  `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm docs:build`.
- Releases use changesets: create a `.changeset/<slug>.md` file by hand (copy the format
  of any existing file there).
- Conventional commits (`feat(ai): …`).
- Reference adapter to copy: `packages/ai-anthropic` if it exists, else
  `packages/ai-google`. Copy its `package.json` metadata shape (description, keywords,
  `repository.directory`, license Apache-2.0, `type: module`, dist exports, `files`,
  engines, scripts), `tsconfig.json`, `tsconfig.build.json`, and README structure.

## Step 1 — Package scaffold

Create `packages/ai-<provider>/` with `package.json` (name `@askdb/ai-<provider>`,
version `0.1.0-beta.0`), tsconfigs, and README copied from the reference adapter,
adjusting names/keywords/directory. Dependencies:

- `dependencies`: `{ "<sdk>": "^<latest major from npm view>" }`
- `peerDependencies`: `{ "ai": "^6.0.0", "@askdb/ai": "workspace:^" }`
  (match the exact ranges the reference adapter uses — read, don't assume)
- `devDependencies`: `ai`, `"@askdb/ai": "workspace:*"`, `typescript`, `vitest`
  (versions copied from the reference adapter)

## Step 2 — Adapter implementation

`packages/ai-<provider>/src/index.ts`, following this template (the anthropic/google
adapters are live exemplars — diff against them):

```ts
import { create<X> } from "<sdk>";
import { resolveBaseConfig, type AiProviderAdapter, type ProviderEnvSpec } from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["<PROVIDER>_API_KEY"],
  modelVars: ["<PROVIDER>_MODEL"],          // only if a native convention exists
  embeddingModelVars: ["<PROVIDER>_EMBEDDING_MODEL"], // only if embeddings exist
  baseURLVars: ["<PROVIDER>_BASE_URL"],
  defaultModel: "<defaultModel>",
  // defaultEmbeddingModel only when the provider has a sensible default
};

export const <provider>Provider: AiProviderAdapter = {
  provider: "<provider>",
  // aliases: ["..."],  // only if real alternative spellings exist
  configHint:
    "For <ProviderName>, set ASKDB_AI_PROVIDER=<provider> plus <PROVIDER>_API_KEY (or ASKDB_AI_API_KEY).",
  resolveConfig(env, options) {
    return resolveBaseConfig("<provider>", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const p = create<X>({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return p(config.model);
  },
  createEmbeddingModel(config, options = {}) {
    // If the SDK has embeddings: build the model, then forward options via the
    // shared helper: return withEmbeddingProviderOptions(model, "<provider>", options);
    // (import withEmbeddingProviderOptions from "@askdb/ai")
    // If the provider has NO embeddings API, throw instead:
    throw new Error(
      "<ProviderName> does not provide an embeddings API. Configure a different " +
        "embedding provider while using <ProviderName> for chat.",
    );
  },
};
```

Rules:

- Provider-specific connection settings beyond apiKey/baseURL/model (an Azure-style
  resource name, region, project id) go into `config.providerOptions` inside a custom
  `resolveConfig` wrapper around `resolveBaseConfig`, never as new `AiConfig` fields —
  see `packages/ai-azure/src/index.ts` for the pattern, including validation that throws
  a clear message when a required setting is missing.
- Auth that is not an API key (OAuth, SigV4/AWS credentials): **STOP and report** —
  `AiConfig.apiKey` is required by contract and the no-key-means-disabled rule; that
  contract change needs its own design pass.

## Step 3 — Tests

`packages/ai-<provider>/src/index.test.ts`, modeled on
`packages/ai-openai/src/index.test.ts` (`vi.hoisted` + `vi.mock` of the SDK). Required
cases: provider id; language-model construction passes apiKey and baseURL; embeddings
(construction with forwarded options, or the throw with a message containing
"embeddings"); `resolveConfig` resolves the native key var; default model applied;
returns `undefined` when no key is configured.

**Verify**: `pnpm install && pnpm --filter @askdb/ai-<provider> build && pnpm --filter @askdb/ai-<provider> test` → exit 0.

## Step 4 — Wire into the monorepo

1. **Surfaces (batteries-included policy — all four):** add
   `"@askdb/ai-<provider>": "workspace:*"` to dependencies of `apps/cli`,
   `apps/http-api`, `apps/studio`, `packages/tui`; import the adapter and append it to
   the `createAiRegistry([...])` array in `apps/cli/src/cli.ts`,
   `apps/http-api/src/server.ts`, `apps/studio/src/server.ts`, `packages/tui/src/cli.ts`.
2. **Smoke test:** add `packages/ai-<provider>` to the pack list in
   `examples/installable-smoke/run.sh` (alongside the other `packages/ai-*` entries).
3. **Config package (optional but expected for first-party providers):** in
   `packages/config` add a dedicated branch mirroring the anthropic one — a
   `<Provider>Config` type in `src/types.ts`, an `apply<Provider>Ai()` in
   `src/flatten.ts` writing the native env keys plus `ASKDB_AI_MODEL`, a
   `DEFAULT_<PROVIDER>_CHAT_MODEL` in `src/defaults.ts`, and flatten tests. If you skip
   this, the provider is still usable via the generic custom-provider branch
   (`provider: "<provider>"` flattens to the universal `ASKDB_AI_*` keys) — say so in
   the changeset.

**Verify**: `pnpm build && pnpm lint && pnpm test` → exit 0;
`grep -rln "<provider>Provider" apps packages/tui/src` → 4 files.

## Step 5 — Docs

- `docs/integration/installable-package.md`: add a provider recipe section (env form +
  `askdb.config.ts` form), formatted like the existing provider sections.
- `docs/architecture.md`: add the package to the package-map mermaid, the
  dependency-boundaries mermaid, and the package table (follow the existing `ai-*` rows).
- Docs site: `apps/docs-site/src/content/docs/reference/packages.mdx` (adapter install
  list) and `reference/config.mdx` (env-var table) — match surrounding formatting.
- Mention the provider in the TUI help text provider list (`packages/tui/src/cli.ts`,
  the `printHelp` block) if it enumerates providers.

**Verify**: `pnpm docs:build` → exit 0.

## Step 6 — Changeset and final gate

Create `.changeset/add-<provider>-provider.md`: minor bump for `@askdb/ai-<provider>`
(new) and every app/package whose dependencies changed; body modeled on
`.changeset/add-google-gemini-provider.md` (state the env vars, the default model, and
the config branch or its absence).

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
- Auth is not API-key based (see Step 2).
- The prerequisite greps fail (pre-contract-v2 codebase).
- Any final-gate command fails twice after a reasonable fix attempt.
