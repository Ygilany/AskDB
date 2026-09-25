# Plan 058: Make the RAG embedder config provider-neutral

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report. When done, update this plan's row in `plans/README.md`, unless a reviewer dispatched you and said they maintain the index.
>
> **Readiness check (run first)**: every command must print the expected result, or STOP.
>
> ```bash
> for n in 193 198; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done   # → MERGED ×2
> git grep -n "BUILTIN_AI_PROVIDERS" -- packages/ai/src/providers/index.ts | head -1       # → match (#198)
> git grep -n "defaultEmbeddingModel" -- packages/ai/src/providers/google.ts               # → NO match (Google has no default embedding model yet)
> # The bug is still live: ai-sdk embedder requires the OpenAI branch and pins an OpenAI model.
> git grep -n 'rag.embedderConfig.openai is required for embedder' -- packages/config/src/flatten.ts  # → 2 matches
> git grep -n "function fallbackStudioRagProvider" -- apps/studio/src/server.ts              # → 1 match
> ```

## Status

- **Priority**: P1 — raised by the reviewer: `buildStudioRagEmbeddingEnv` maps the RAG API key onto `ASKDB_AI_API_KEY`, so with `ai.provider: "google"` Studio sends the OpenAI key to Google (credential sent to the wrong provider).
- **Effort**: M
- **Risk**: MED. Studio RAG embedder ids change for non-OpenAI providers, which forces a one-time reindex.
- **Depends on**: #193 and #198 (merged). Plan 040 (optional `rag` block) is related but not required. See "Relation to plan 040".
- **Category**: bug
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: no. Additive config branch. `embedderConfig.openai` stays valid but is deprecated.

## Why this matters

With `ai.provider: "google"` and `rag.embedder: "ai-sdk"`, Studio asks Google for the OpenAI embedding model `text-embedding-3-small`. It can also send the OpenAI RAG key to Google. The RAG config only has an OpenAI-shaped branch, and the flattened keys override the selected provider's defaults.

The `@askdb/ai` provider table (post-#198) already knows which providers offer embeddings and their default embedding models. The RAG config should reuse that table instead of assuming OpenAI.

## Current state

Verified on `review/integration-check @ c7404d4`.

### Config type (`packages/config/src/types.ts`)

```ts
export type OpenaiRagEmbedderConfig = { model?: string; dimension?: string | number; apiKey?: string; baseUrl?: string };
...
  rag: {
    embedder: AskDbRagEmbedder;            // "mock" | "openai" | "ai-sdk"
    embedderConfig: { openai?: OpenaiRagEmbedderConfig };
    store: AskDbRagStore;
    storeConfig: { file?: FileStoreConfig; memory?: MemoryStoreConfig; pgvector?: PgvectorStoreConfig };
  };
```

### Flatten (`packages/config/src/flatten.ts`, RAG section)

```ts
  if (rag.embedder === "openai" || rag.embedder === "ai-sdk") {
    const ec = rag.embedderConfig.openai;
    if (!ec) {
      throw new Error(`askdb.config: rag.embedderConfig.openai is required for embedder "${rag.embedder}".`);
    }
    const model = ec.model?.trim() || DEFAULT_RAG_EMBEDDING_MODEL;   // "text-embedding-3-small"
    set(out, "ASKDB_RAG_EMBEDDER_MODEL", model);
    set(out, "ASKDB_RAG_EMBEDDER_DIMENSIONS", String(resolvedRagDimensions));
    set(out, "ASKDB_RAG_EMBEDDER_API_KEY", ec.apiKey);
    set(out, "ASKDB_RAG_EMBEDDER_BASE_URL", ec.baseUrl);
  }
```

`resolveRagEmbeddingDimensions` repeats the same `.openai` requirement. `defaultRagEmbeddingDimensions` in `defaults.ts` only knows OpenAI model ids.

### Studio (`apps/studio/src/server.ts`)

`resolveStudioRagEmbedderConfig()` builds an env overlay and resolves with an OpenAI default that outranks the provider's own default. In `resolveBaseConfig`'s precedence (`packages/ai/src/provider.ts`), `env[modelEnvVar]` comes first and `modelDefault` beats the provider's `defaultEmbeddingModel`:

```ts
  const env = buildStudioRagEmbeddingEnv(kind, base);
  const aiConfig = ai.resolveEmbeddingConfig(env, {
    modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL",
    modelDefault: DEFAULT_EMBEDDING_MODEL,         // "text-embedding-3-small"
  });
  ...
  const provider = aiConfig?.provider ?? fallbackStudioRagProvider(kind, base);
```

```ts
function buildStudioRagEmbeddingEnv(kind: string | undefined, base: AiEnv): AiEnv {
  const apiKeyOverride = pickEnv(base, "ASKDB_RAG_EMBEDDER_API_KEY");
  ...
    ...(apiKeyOverride ? { ASKDB_AI_API_KEY: apiKeyOverride } : {}),   // OpenAI RAG key → whatever provider is selected

function fallbackStudioRagProvider(kind: string | undefined, base: AiEnv): AiProvider {
  if (kind === "openai") return "openai";
  const raw = (pickEnv(base, "ASKDB_AI_PROVIDER") ?? "").toLowerCase();
  return raw === "azure" || raw === "azure-openai" || raw === "foundry" ? "azure" : "openai";
}
```

Studio also has its own `defaultEmbeddingDimensions(model)` (a third copy of the OpenAI-only table).

### Provider table (`packages/ai/src/providers/*.ts`)

- `BuiltinAiProvider.embeddings: boolean` is `false` for Anthropic, whose `createEmbeddingModel` throws.
- `env.defaultEmbeddingModel` is `text-embedding-3-small` for openai and azure (Azure treats it as the deployment name) and `openai/text-embedding-3-small` for gateway. **Google has none.**
- `@ai-sdk/google@4` declares `GoogleEmbeddingModelId = 'gemini-embedding-001' | 'gemini-embedding-2' | …`.

### Convention that applies

`@askdb/config` must not depend on `@askdb/ai`. It keeps its own copies of provider ids and default models, and `packages/ai/src/providers/config-drift.test.ts` fails when they disagree. Match that pattern for embedding defaults.

### Other defects on the same surface

- `apps/docs-site/src/content/docs/reference/config.mdx` and `guides/rag-for-large-schemas.mdx` show `rag: { embedder: "openai", store: …}` with no `embedderConfig`. That fails flatten ("rag.embedderConfig.openai is required") and the type check.
- The config field table in `reference/config.mdx` says the embedder is `mock` or `openai`, and omits `ai-sdk`.

## Design

Add a provider-neutral branch. `openai` stays as a deprecated alias.

```ts
export type AiRagEmbedderConfig = {
  /** AI provider for embeddings. Default: `ai.provider`. Must offer embeddings (not "anthropic"). */
  provider?: string;
  /** Embedding model. Default: the provider's default embedding model. */
  model?: string;
  /** Output dimensions. Required when the model's default is unknown to AskDB. */
  dimensions?: string | number;
  /** Only needed when `provider` differs from `ai.provider` or uses a separate key. */
  apiKey?: string;
  baseUrl?: string;
};
  rag.embedderConfig: { ai?: AiRagEmbedderConfig; /** @deprecated use `ai` with provider "openai" */ openai?: OpenaiRagEmbedderConfig };
```

Resolution rules:

- `embedder: "ai-sdk"`: provider is `embedderConfig.ai.provider ?? ai.provider`.
- `embedder: "openai"`: provider is `"openai"`. It reads `embedderConfig.ai ?? embedderConfig.openai`, with `.openai`'s `dimension` accepted as `dimensions`.
- Neither branch is required.

Flatten emits:

- `ASKDB_RAG_EMBEDDER_PROVIDER`
- `ASKDB_RAG_EMBEDDER_MODEL` **only when explicitly set**
- `ASKDB_RAG_EMBEDDER_DIMENSIONS` when explicit or known for the resolved model
- `ASKDB_RAG_EMBEDDER_API_KEY` / `_BASE_URL`, only when explicit

`@askdb/config`'s runtime view gains `rt.rag.embeddingEnv`: an `AiEnv` overlay that any `@askdb/ai` registry can pass straight to `resolveEmbeddingConfig`, with no RAG-specific logic in `@askdb/ai`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install / build / lint / test | `pnpm install && pnpm build && pnpm lint && pnpm test` | exit 0 |
| Config tests | `pnpm --filter @askdb/config exec vitest run --config ../../vitest.config.ts src/config.test.ts` | pass |
| Studio tests | `pnpm --filter @askdb/studio exec vitest run --config ../../vitest.config.ts src/server.test.ts` | pass |
| Docs | `pnpm docs:build` | exit 0 |
| Release gates | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**:
- `packages/config/src/{types,flatten,defaults,constants,runtime-config,index}.ts` and `config.test.ts`
- `packages/ai/src/providers/google.ts` (add `defaultEmbeddingModel`) and `providers/config-drift.test.ts`
- `apps/studio/src/server.ts` (RAG embedder resolution only) and `server.test.ts`
- Docs: `apps/docs-site/src/content/docs/reference/config.mdx`, `guides/rag-for-large-schemas.mdx`, `guides/bring-your-own-model.mdx` (the Anthropic "no embeddings" note, if present), `packages/config/README.md` (the `rag:` example and the `config.rag.embedder` snippet)
- `.changeset/provider-neutral-rag-embedder.md`

**Out of scope**:
- The `askdb-rag` CLI (`packages/rag/src/cli.ts`). Plan 059 moves it and consumes this plan's `rt.rag` view. Don't edit it here.
- Making `rag` optional. That is plan 040.
- Unifying the Studio and CLI mock embedders.
- `apps/cli/src/init.ts` and `apps/studio/src/setup.ts` renderers. They emit `embedder: "mock"`, which is unaffected.

## Git workflow

- Branch `plan/058-provider-neutral-rag-embedder`. Commit style: `fix(config,studio): provider-neutral RAG embedder config`.
- Open one PR and don't merge it.

## Steps

### Step 1: Write the failing regression first

In `apps/studio/src/server.test.ts`, add a case that builds a **structured** config (`ai.provider: "google"` with a key, `rag: { embedder: "ai-sdk", embedderConfig: {}, store: "memory", storeConfig: {} }`). Install it with the existing `installStudioRuntime({}, structured)` helper. That helper already calls `flattenAskDbConfig(structured)`, so the test crosses the real config→Studio seam; don't hand-write flat keys. Then `GET /api/rag/status`.

Expect `embedder.provider === "google"` and `expectedEmbedderId` to contain `gemini-embedding-001`. Run it on unmodified code: it must **fail**. Today flatten throws because the `.openai` branch is missing.

**Verify**: the new test fails for that reason. Paste the failure into the PR description.

### Step 2: Provider embedding defaults in `@askdb/config` (with the drift guard)

- In `packages/ai/src/providers/google.ts` `ENV_SPEC`, add `defaultEmbeddingModel: "gemini-embedding-001"`.
- In `packages/config/src/defaults.ts`, add a `DEFAULT_RAG_EMBEDDING_MODELS: Record<string, string>` map for openai, azure, google, and gateway. Replace `defaultRagEmbeddingDimensions(model)` with `knownRagEmbeddingDimensions(model): number | undefined`. It knows the three OpenAI ids plus `gateway` `openai/…` equivalents, and returns `undefined` otherwise. Only add a Google dimension if you verify it from Google's embedding docs; otherwise leave it `undefined`, which requires explicit `dimensions`.
- Keep `defaultRagEmbeddingDimensions` exported as a deprecated wrapper returning `knownRagEmbeddingDimensions(m) ?? 1536`, so the public export doesn't break.
- In `config-drift.test.ts`, add a case: for every `BUILTIN_AI_PROVIDERS` row with `embeddings: true`, `DEFAULT_RAG_EMBEDDING_MODELS[row.provider] === row.env.defaultEmbeddingModel`, and no key exists for a provider with `embeddings: false`.

**Verify**: `pnpm --filter @askdb/ai test` → pass, including the new drift case.

### Step 3: Config type, flatten, runtime view

- **`types.ts`**: add `AiRagEmbedderConfig` and `embedderConfig.ai`. Mark `.openai` `@deprecated`. Update the `ASKDB_RAG_EMBEDDERS` JSDoc in `constants.ts`.
- **`flatten.ts`**: implement the Design rules.
  - Validate the resolved provider against `ASKDB_AI_PROVIDERS` minus `anthropic`, plus custom ids when `ai.provider` is custom.
  - If the provider is `anthropic`, throw: `askdb.config: ai.provider "anthropic" has no embeddings API; set rag.embedderConfig.ai.provider (e.g. "openai") and its apiKey.`
  - Dimensions come from explicit `dimensions` (or `.openai.dimension`), else `knownRagEmbeddingDimensions(model ?? DEFAULT_RAG_EMBEDDING_MODELS[provider])`.
  - If still unknown and `store === "pgvector"`, throw: `askdb.config: set rag.embedderConfig.ai.dimensions for embedding model "<model>"`. The pgvector table needs a fixed width.
  - Keep `ASKDB_RAG_EMBEDDER` unchanged.
- **`runtime-config.ts`**: extend `AskDbRuntimeRagConfig` with `embedder.provider`, `embedder.dimensions`, and `embeddingEnv: AiEnv`. Build `embeddingEnv` from `aiEnv`:
  - Set `ASKDB_AI_PROVIDER` to the RAG provider.
  - When the RAG provider differs from `ai.provider`, **delete** `ASKDB_AI_API_KEY`, `ASKDB_AI_BASE_URL`, `ASKDB_AI_MODEL`, and `ASKDB_AI_EMBEDDING_MODEL` inherited from the chat side, so a chat key never goes to another provider.
  - Map `ASKDB_RAG_EMBEDDER_API_KEY` / `_BASE_URL` / `_MODEL` to `ASKDB_AI_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_EMBEDDING_MODEL`.
  - Keep the existing `embedder.apiKey` / `baseURL` / `model` fields for compatibility. Plan 059 stops using them.

**Verify**: `pnpm --filter @askdb/config lint && pnpm --filter @askdb/config test` → pass.

### Step 4: Studio consumes the runtime view

In `resolveStudioRagEmbedderConfig`:

- Call `ai.resolveEmbeddingConfig(rt.rag.embeddingEnv)` with **no** `modelDefault` and no `modelEnvVar`.
- Take the dimensions from `rt.rag.embedder.dimensions` (flat `ASKDB_RAG_EMBEDDER_DIMENSIONS` still wins as today).
- Delete `buildStudioRagEmbeddingEnv`, `fallbackStudioRagProvider`, `DEFAULT_EMBEDDING_MODEL`, and Studio's `defaultEmbeddingDimensions`.
- For "configured: false" status, derive the provider from `findBuiltinAiProvider(rt.rag.embedder.provider)?.provider ?? rt.rag.embedder.provider`.
- If a non-mock embedder has unknown dimensions, return a 400 `StudioHttpError` naming `rag.embedderConfig.ai.dimensions`.
- Keep the "no key and no explicit embedder → mock" fallback unchanged.

**Verify**: Step 1's test passes. `pnpm --filter @askdb/studio test` → pass. `git grep -n "fallbackStudioRagProvider\|text-embedding-3-small" apps/studio/src/server.ts` → no matches.

### Step 5: Tests (apply the test-audit authoring gate)

- **Owner boundary for the flatten contract**: `packages/config/src/config.test.ts`. Use one table-driven block. Cases:
  1. `ai-sdk` + google with no branch emits provider `google` and no `ASKDB_RAG_EMBEDDER_MODEL`. Regression caught: the OpenAI model gets pinned again.
  2. Anthropic chat + `ai: { provider: "openai", apiKey }` works, and its `embeddingEnv` has no chat `ASKDB_AI_API_KEY`. Regression caught: a key leaks across providers.
  3. Anthropic chat with no RAG provider throws the message above.
  4. The legacy `embedder: "openai"` + `.openai: { model, dimension }` produces the same keys as before. Regression caught: a compatibility break.
  5. pgvector + unknown model + no dimensions throws.
- **Owner boundary for "what Studio asks the provider for"**: `server.test.ts`, with Step 1's test plus one Azure case updated to the new resolution. Do not duplicate the flatten cases there.
- The drift test from Step 2.

**Verify**: `pnpm test` → exit 0.

### Step 6: Docs, changeset, gates

- **`reference/config.mdx`**: fix the example (add `embedderConfig`), add an `rag.embedderConfig.ai` field table, list `ai-sdk`, mark `.openai` deprecated, and state that Anthropic needs a separate embedding provider.
- **`guides/rag-for-large-schemas.mdx`**: fix the Path 1 config example the same way. Show `embedder: "ai-sdk"` reusing `ai.provider`.
- **Changeset**: `@askdb/config` minor, `@askdb/ai` patch (Google default embedding model), `@askdb/studio` patch. Note in the changeset that Studio indexes built with a non-OpenAI provider get a new embedder id and must be reindexed once.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0. `pnpm changeset status` → no `major`.

## Relation to plan 040

Plan 040 makes `rag` optional and defaults to `mock` + `memory`. This plan's resolution already treats a missing `embedderConfig.ai` as "use `ai.provider`", so the two compose.

**Note for 040's executor**: Studio's `resolveStudioRagStoreConfig` reads `rt.structured.rag.store` directly, a consumer 040's "single consumer" analysis missed. 040 must route it through a defaulted value. If 058 lands first, add `rt.rag.store` to the runtime view here and let 040 fill its default.

## Done criteria

- [ ] Step 1's regression failed before the fix and passes after.
- [ ] `git grep -n 'rag.embedderConfig.openai is required' packages/config/src` → no matches.
- [ ] `git grep -n "fallbackStudioRagProvider" apps/studio/src` → no matches.
- [ ] The drift test covers embedding defaults.
- [ ] Docs examples flatten. Paste each changed `rag:` example into a scratch config and run `flattenAskDbConfig` in a one-off vitest case, or reuse a config test.
- [ ] All gates exit 0. The changeset is present.

## STOP conditions

- You can't verify a Google embedding dimension and a Studio test needs one. Use explicit `dimensions` in the test instead of guessing.
- Removing the chat-side `ASKDB_AI_*` keys from `embeddingEnv` breaks the existing Azure Studio test in a way that suggests Azure relies on them. Report which key.
- A custom (non-built-in) `ai.provider` appears in any existing test or fixture with an `ai-sdk` embedder. Confirm the intended semantics before changing them.

## Maintenance notes

- New built-in providers with embeddings need a `DEFAULT_RAG_EMBEDDING_MODELS` entry. The drift test enforces it.
- Plan 059 (`askdb rag`) should build its embedder from `rt.rag.embeddingEnv` + `createAiRegistry()` + `createAiSdkEmbedder`, using the same embedder-id format as Studio (`ai-sdk:<provider>:<model>:<dims>`).
- Remove `embedderConfig.openai` and the `embedder: "openai"` value at the 1.0 cutover.
