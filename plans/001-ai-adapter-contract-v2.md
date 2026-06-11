# Plan 001: Make AI provider adapters self-describing (open provider contract, adapter-owned env resolution, normalized `ai` peer deps)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 154b17e..HEAD -- packages/ai packages/ai-openai packages/ai-azure packages/ai-google packages/tui/src/cli.ts packages/tui/package.json apps/cli/src/cli.ts apps/cli/package.json apps/http-api/src/server.ts apps/http-api/package.json apps/studio/src/server.ts apps/studio/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `154b17e`, 2026-06-11

## Why this matters

AskDB split AI providers into adapter packages (`@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`) so that adding a provider would not touch shared code (ADR 0006). But `packages/ai/src/provider.ts` still hard-codes every provider: the `AiProvider` union is closed (`"openai" | "azure" | "google"`), `readProvider()` is a hard-coded switch, `resolveAiConfig`/`resolveEmbeddingConfig` know every provider's env vars, and `AiConfig` carries Azure-only fields (`resourceName`, `apiVersion`). So today a new provider still requires editing `@askdb/ai` — the same boundary violation the ADR removed from core, moved one package over. Separately, the `ai` package is declared inconsistently (hard dep in `@askdb/ai`/`ai-openai`/`ai-azure`, **missing entirely** from `ai-google`), which risks duplicate `ai` instances and AI SDK spec-version mismatches in published installs.

After this plan: `AiProvider` is an open `string`; each adapter owns its env-var knowledge, aliases, defaults, and provider-specific config (Azure's `resourceName`/`apiVersion` move into a generic `providerOptions` bag); `@askdb/ai` is pure dispatch plus the universal `ASKDB_AI_*` precedence rules; and `ai` is a peer dependency everywhere except `@askdb/core`. Adding a provider becomes "publish an adapter package" — first-party or third-party. The repo is pre-1.0 (`1.0.0-beta.x`), so this breaking change is cheap now and expensive later.

## Current state

Files and their roles:

- `packages/ai/src/provider.ts` — the whole `@askdb/ai` implementation (353 lines): `AiProvider` union (line 16), `AiConfig` with Azure fields (18–29), `readProvider()` switch (41–49), `resolveAiConfig` (74–139) and `resolveEmbeddingConfig` (163–231) which are ~80% copy-paste of each other, adapter/registry types (240–268), `createAiRegistry` (270–304), `aiKeyMissingMessage` (310–321), `aiProviderMissingMessage` (323–328), `normalizeAdapters` (330–352).
- `packages/ai/src/index.ts` — re-exports everything from `provider.js` (16 lines).
- `packages/ai/src/provider.test.ts` — 31 tests covering env resolution precedence and the registry, all against the standalone `resolveAiConfig`/`resolveEmbeddingConfig` functions.
- `packages/ai-openai/src/index.ts` — `openaiProvider` adapter (39 lines).
- `packages/ai-azure/src/index.ts` — `azureProvider` adapter (43 lines); reads `config.resourceName`/`config.apiVersion`.
- `packages/ai-google/src/index.ts` — `googleProvider` adapter (21 lines); package.json is **missing the `ai` dependency**.
- Registry consumers (all build the same three-adapter registry): `apps/cli/src/cli.ts:36`, `apps/http-api/src/server.ts:35`, `apps/studio/src/server.ts:79`, `packages/tui/src/cli.ts:15`.
- Standalone resolver call sites that must move to registry methods: `apps/cli/src/cli.ts:325`, `apps/http-api/src/server.ts:251`, `apps/studio/src/server.ts:259`, `apps/studio/src/server.ts:475`, `apps/studio/src/server.ts:849`.
- `packages/config/src/runtime-config.ts:11` — doc comment mentioning `resolveAiConfig` (comment-only update).

Key excerpts as of `154b17e` (`packages/ai/src/provider.ts`):

```ts
// line 16
export type AiProvider = "openai" | "azure" | "google";

export type AiConfig = {
  provider: AiProvider;
  apiKey: string;
  /** OpenAI: model id (e.g. `gpt-4o-mini`). Azure: deployment name. */
  model: string;
  /** Custom REST base URL. Optional for OpenAI; for Azure, overrides resourceName. */
  baseURL?: string;
  /** Azure only: resource subdomain ... */
  resourceName?: string;
  /** Azure only: API version (e.g. `2024-10-21`). */
  apiVersion?: string;
};

// lines 38–49
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function readProvider(env: AiEnv): AiProvider {
  const raw = (env.ASKDB_AI_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "" || raw === "openai") return "openai";
  if (raw === "azure" || raw === "azure-openai" || raw === "foundry") return "azure";
  if (raw === "google") return "google";
  throw new Error(
    `Unknown ASKDB_AI_PROVIDER "${env.ASKDB_AI_PROVIDER}". Expected "openai", "azure", or "google".`,
  );
}
```

The universal precedence rules (must be preserved exactly — these are the contract documented in the JSDoc at lines 51–73):

- API key: `ASKDB_AI_API_KEY` → provider-native primary → provider-native secondary → `ASKDB_AI_API_KEY_SECONDARY`. No key → return `undefined` ("AI disabled", never throw).
- Language model: `ASKDB_AI_MODEL` → `ASKDB_MODEL` → provider-native model var → `options.modelDefault` → default.
- Embedding model: `env[options.modelEnvVar]` → `ASKDB_AI_EMBEDDING_MODEL` → `ASKDB_EMBEDDING_MODEL` → provider-native embedding var → `options.modelDefault` → default.
- Base URL: `ASKDB_AI_BASE_URL` → provider-native base-URL var → undefined.

Provider-native env vars currently hard-coded in `provider.ts` (these move into the adapters):

| Provider | key primary | key secondary | language model | embedding model | baseURL | extra |
|---|---|---|---|---|---|---|
| openai | `OPENAI_API_KEY` | `OPENAI_API_KEY_SECONDARY` | `OPENAI_MODEL` | `OPENAI_EMBEDDING_MODEL` | `OPENAI_BASE_URL` | — |
| azure | `AZURE_OPENAI_API_KEY`, `AZURE_API_KEY` | `AZURE_OPENAI_API_KEY_SECONDARY`, `AZURE_API_KEY_SECONDARY` | `AZURE_OPENAI_DEPLOYMENT`, `AZURE_DEPLOYMENT_NAME` | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`, `AZURE_EMBEDDING_DEPLOYMENT_NAME` | `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_ENDPOINT`, `AZURE_BASE_URL` | `ASKDB_AI_AZURE_RESOURCE_NAME`/`AZURE_RESOURCE_NAME`, `ASKDB_AI_AZURE_API_VERSION`/`AZURE_OPENAI_API_VERSION`/`AZURE_API_VERSION`; throws if neither baseURL nor resourceName |
| google | `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_AI_API_KEY` | *(falls through to `OPENAI_API_KEY_SECONDARY` — latent bug, see Step 4)* | `GOOGLE_AI_MODEL` | `GOOGLE_AI_EMBEDDING_MODEL` | `GOOGLE_AI_BASE_URL` | — |

Dependency state (`package.json` of each):

- `@askdb/ai`: `dependencies: { "ai": "^6.0.200" }`
- `@askdb/ai-openai`: deps `@ai-sdk/openai ^3.0.69`, `@askdb/ai workspace:*`, `ai ^6.0.200`
- `@askdb/ai-azure`: deps `@ai-sdk/azure ^3.0.72`, `@askdb/ai workspace:*`, `ai ^6.0.200`
- `@askdb/ai-google`: deps `@ai-sdk/google ^3.0.80`, `@askdb/ai workspace:*` — **no `ai`**
- `@askdb/core`: hard dep `ai ^6.0.200` — **stays a hard dep** (it calls `generateText`; ADR 0006 blesses this)
- `@askdb/rag`: `ai` already an optional peer — do not touch
- Apps: `apps/studio` has `ai ^6.0.200`; `apps/cli`, `apps/http-api`, `packages/tui` do not declare `ai`.

Repo conventions: TypeScript ESM (`.js` import suffixes), strict tsc as lint (`tsc --noEmit`), vitest with `--config ../../vitest.config.ts`, conventional-commit-style messages (`fix(ai): …`, `chore: …`), releases via changesets (`.changeset/*.md` files — see `.changeset/add-google-gemini-provider.md` for the format). Adapter tests mock the provider SDK with `vi.mock` — see `packages/ai-openai/src/index.test.ts` for the exemplar.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build all | `pnpm build` | exit 0 |
| Lint (tsc) all | `pnpm lint` | exit 0 |
| Test all | `pnpm test` | exit 0, all pass |
| Test one pkg | `pnpm --filter @askdb/ai test` | exit 0 |
| Smoke (packed tarball install) | `pnpm smoke:install` | exit 0 (slow; run once at the end) |

## Scope

**In scope** (the only files you should modify):

- `packages/ai/src/provider.ts`, `packages/ai/src/index.ts`, `packages/ai/src/provider.test.ts`, `packages/ai/package.json`
- `packages/ai-openai/src/index.ts`, `index.test.ts`, `package.json`
- `packages/ai-azure/src/index.ts`, `index.test.ts`, `package.json`
- `packages/ai-google/src/index.ts`, `index.test.ts`, `package.json`
- `apps/cli/src/cli.ts`, `apps/cli/package.json`
- `apps/http-api/src/server.ts`, `apps/http-api/package.json`
- `apps/studio/src/server.ts`, `apps/studio/package.json`
- `packages/tui/package.json` (deps only; `packages/tui/src/cli.ts` only if tsc requires it)
- `packages/config/src/runtime-config.ts` (doc comment only)
- `.changeset/<new-file>.md` (create)
- READMEs of the four AI packages if they show now-removed APIs (`packages/ai/README.md`, `packages/ai-*/README.md`)

**Out of scope** (do NOT touch, even though they look related):

- `@askdb/core` — its hard `ai` dependency is deliberate (ADR 0006).
- `@askdb/rag` — its optional-peer setup is already correct; embedder cleanup is plan 002.
- `packages/config/src/types.ts` / `flatten.ts` — the `askdb.config` provider branches are a separate authoring-time layer; they emit env keys that adapters read, and that interface does not change. (Anthropic support there is plan 004.)
- `aiKeyMissingMessage` content — registry-driven messages are plan 004. Keep the function exactly as-is.
- `docs/architecture.md`, ADRs — plan 003.

## Git workflow

- Branch: `advisor/001-ai-adapter-contract-v2` off the current branch's base (`origin/main`).
- Conventional commits, e.g. `refactor(ai)!: adapter-owned env resolution and open provider contract` (repo examples: `fix(studio): auto-refresh RAG stale badge after saves`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the `@askdb/ai` contract in `packages/ai/src/provider.ts`

Replace the closed types and duplicated resolvers with the following target shape (keep the existing JSDoc explanations of the precedence rules, adapted):

```ts
import type { EmbeddingModel, LanguageModel } from "ai";

export type AiProvider = string;

export type AiConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Provider-specific connection settings, interpreted only by the owning adapter. */
  providerOptions?: Record<string, unknown>;
};

export type AiEnv = Record<string, string | undefined>;

export type AiUsage = "language" | "embedding";

export type ResolveConfigOptions = {
  usage: AiUsage;
  /** Default model when no env override is set. */
  modelDefault?: string;
  /** Per-app embedding model env var (e.g. `ASKDB_RAG_EMBEDDER_MODEL`). Embedding usage only. */
  modelEnvVar?: string;
};

/** Declarative description of one provider's native env vars, consumed by `resolveBaseConfig`. */
export type ProviderEnvSpec = {
  apiKeyVars: readonly string[];
  apiKeySecondaryVars?: readonly string[];
  modelVars?: readonly string[];
  embeddingModelVars?: readonly string[];
  baseURLVars?: readonly string[];
  defaultModel?: string;
  defaultEmbeddingModel?: string;
};

export type CreateEmbeddingModelOptions = { dimensions?: number; user?: string };

export type AiProviderAdapter = {
  provider: string;
  /** Additional ASKDB_AI_PROVIDER values that select this adapter (e.g. ["azure-openai", "foundry"]). */
  aliases?: readonly string[];
  /** Resolve an AiConfig from env. Return undefined when no API key is configured ("AI disabled"). */
  resolveConfig(env: AiEnv, options: ResolveConfigOptions): AiConfig | undefined;
  createLanguageModel(config: AiConfig): Promise<LanguageModel> | LanguageModel;
  createEmbeddingModel(
    config: AiConfig,
    options?: CreateEmbeddingModelOptions,
  ): Promise<EmbeddingModel> | EmbeddingModel;
};
```

Implement `resolveBaseConfig(provider: string, env: AiEnv, spec: ProviderEnvSpec, options: ResolveConfigOptions): AiConfig | undefined` and export it. It encodes the universal precedence exactly as documented in "Current state" (key, model by usage, baseURL). Helper detail: `first(env, vars)` returns the first non-empty value. If no model can be resolved (no env var, no `options.modelDefault`, no spec default), throw `new Error(\`${provider}: no ${options.usage} model configured. Set ASKDB_AI_MODEL (or the provider's native model variable).\`)` — with today's adapters this path is only reachable for google embeddings (see Step 4).

Update the registry:

- `normalizeAdapters` keys the map by `adapter.provider` **plus every entry of `adapter.aliases`**, lowercased. Keep the array form and the record form of `AiProviderAdapters` (record values must still satisfy the key↔`adapter.provider` check; aliases are taken from the adapter itself).
- Replace `readProvider` with a registry-internal `selectAdapter(env)`: `raw = (env.ASKDB_AI_PROVIDER ?? "").toLowerCase().trim()`; empty string defaults to `"openai"`; unknown values throw `` `Unknown ASKDB_AI_PROVIDER "${env.ASKDB_AI_PROVIDER}". Registered providers: ${[...names].join(", ")}.` ``; known-but-unregistered (only possible via empty default) falls through to `aiProviderMissingMessage`.
- Add two public registry methods, mirroring the old standalone signatures:

```ts
resolveAiConfig(env: AiEnv, options?: { modelDefault?: string }): AiConfig | undefined;
resolveEmbeddingConfig(
  env: AiEnv,
  options?: { modelDefault?: string; modelEnvVar?: string },
): AiConfig | undefined;
```

  Each selects the adapter from env and delegates to `adapter.resolveConfig(env, { usage, ...options })`.
- `createLanguageModelFromEnv` / `createEmbeddingModelFromEnv` now call the new methods, then the adapter's create function. `hasProvider(provider: string)` (also matches aliases).
- **Delete** the standalone `resolveAiConfig`, `resolveEmbeddingConfig`, `ResolveAiConfigOptions`, `ResolveEmbeddingConfigOptions` exports, and the `DEFAULT_MODEL`/`DEFAULT_EMBEDDING_MODEL` constants (defaults move into adapter specs). Keep `aiKeyMissingMessage` and `aiProviderMissingMessage` byte-identical.
- Update `packages/ai/src/index.ts` to export the new surface: `createAiRegistry`, `resolveBaseConfig`, `aiKeyMissingMessage`, `aiProviderMissingMessage`, and the types `AiProvider`, `AiConfig`, `AiEnv`, `AiUsage`, `ResolveConfigOptions`, `ProviderEnvSpec`, `AiProviderAdapter`, `AiProviderAdapters`, `AiRegistry`, `CreateEmbeddingModelOptions`.

**Verify**: `pnpm --filter @askdb/ai build` → exit 0 (tests will fail until Step 6 — that's expected; do not run them yet).

### Step 2: Move OpenAI env knowledge into `packages/ai-openai/src/index.ts`

Add to `openaiProvider`:

```ts
const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["OPENAI_API_KEY"],
  apiKeySecondaryVars: ["OPENAI_API_KEY_SECONDARY"],
  modelVars: ["OPENAI_MODEL"],
  embeddingModelVars: ["OPENAI_EMBEDDING_MODEL"],
  baseURLVars: ["OPENAI_BASE_URL"],
  defaultModel: "gpt-4o-mini",
  defaultEmbeddingModel: "text-embedding-3-small",
};

export const openaiProvider: AiProviderAdapter = {
  provider: "openai",
  resolveConfig(env, options) {
    return resolveBaseConfig("openai", env, ENV_SPEC, options);
  },
  // createLanguageModel / createEmbeddingModel unchanged
};
```

`resolveBaseConfig` is a value import from `@askdb/ai` (no longer type-only).

**Verify**: `pnpm --filter @askdb/ai-openai build` → exit 0.

### Step 3: Move Azure env knowledge and provider options into `packages/ai-azure/src/index.ts`

Spec: `apiKeyVars: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"]`, `apiKeySecondaryVars: ["AZURE_OPENAI_API_KEY_SECONDARY", "AZURE_API_KEY_SECONDARY"]`, `modelVars: ["AZURE_OPENAI_DEPLOYMENT", "AZURE_DEPLOYMENT_NAME"]`, `embeddingModelVars: ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "AZURE_EMBEDDING_DEPLOYMENT_NAME"]`, `baseURLVars: ["AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT", "AZURE_BASE_URL"]`, defaults `"gpt-4o-mini"` / `"text-embedding-3-small"` (today's behavior — deployment-name fallback, preserved deliberately).

`resolveConfig` wraps `resolveBaseConfig`, then:

- `resourceName = env.ASKDB_AI_AZURE_RESOURCE_NAME || env.AZURE_RESOURCE_NAME || undefined`
- `apiVersion = env.ASKDB_AI_AZURE_API_VERSION || env.AZURE_OPENAI_API_VERSION || env.AZURE_API_VERSION || undefined`
- If a config was resolved and `!config.baseURL && !resourceName`, throw the exact existing message: `"Azure provider requires ASKDB_AI_AZURE_RESOURCE_NAME (e.g. 'my-foundry') or ASKDB_AI_BASE_URL pointing at the full endpoint."`
- Attach `providerOptions: { ...(resourceName ? { resourceName } : {}), ...(apiVersion ? { apiVersion } : {}) }` only when non-empty.
- `aliases: ["azure-openai", "foundry"]` on the adapter.

`createLanguageModel`/`createEmbeddingModel` stop reading `config.resourceName`/`config.apiVersion` and instead read them from `config.providerOptions` via a small local narrowing helper (`typeof v === "string"` checks). Everything else (the `createAzure` call shape, the embedding middleware) stays identical.

**Verify**: `pnpm --filter @askdb/ai-azure build` → exit 0.

### Step 4: Move Google env knowledge into `packages/ai-google/src/index.ts`

Spec: `apiKeyVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_AI_API_KEY"]`, **no `apiKeySecondaryVars`**, `modelVars: ["GOOGLE_AI_MODEL"]`, `embeddingModelVars: ["GOOGLE_AI_EMBEDDING_MODEL"]`, `baseURLVars: ["GOOGLE_AI_BASE_URL"]`, `defaultModel: "gemini-2.0-flash"`, **no `defaultEmbeddingModel`**.

Three deliberate behavior changes — call them out in the changeset:

1. Today google falls back to `OPENAI_API_KEY_SECONDARY` as its "native secondary" key (an artifact of a shared else-branch in `provider.ts:89`/`178`). Dropped. The universal `ASKDB_AI_API_KEY_SECONDARY` still applies.
2. Today google's default language model is `gpt-4o-mini` (the shared `DEFAULT_MODEL`), which the Gemini API rejects at request time. Now `gemini-2.0-flash`, matching `DEFAULT_GOOGLE_CHAT_MODEL` in `packages/config/src/defaults.ts`.
3. Today google's default embedding model is `text-embedding-3-small` (also rejected at request time). Now: no default → `resolveBaseConfig` throws its clear "no embedding model configured" error instead.

**Verify**: `pnpm --filter @askdb/ai-google build` → exit 0.

### Step 5: Update the four registry consumers

The registry construction lines stay as they are. Change only the standalone-resolver call sites and imports:

- `apps/cli/src/cli.ts`: remove `resolveAiConfig` from the `@askdb/ai` import (line 6); line 325 `resolveAiConfig(runtime.ai.aiEnv)` → `ai.resolveAiConfig(runtime.ai.aiEnv)` (the registry `ai` is defined at line 36).
- `apps/http-api/src/server.ts`: import (line 11) and line 251 → `ai.resolveAiConfig(rt.ai.aiEnv)` (registry at line 35).
- `apps/studio/src/server.ts`: imports (lines 11–12); line 259 and line 475 → `ai.resolveAiConfig(rt.ai.aiEnv)`; line 849 → `ai.resolveEmbeddingConfig(env, { modelEnvVar: "ASKDB_RAG_EMBEDDER_MODEL", modelDefault: DEFAULT_EMBEDDING_MODEL })` (registry at line 79; `DEFAULT_EMBEDDING_MODEL` is studio's own local constant at line 143 — keep it).
- `packages/tui/src/cli.ts` uses only `createLanguageModelFromEnv` — no code change expected.
- `packages/config/src/runtime-config.ts:11`: update the doc comment to say "registry methods such as `resolveAiConfig`" (comment only — no code).

**Verify**: `pnpm build` → exit 0. Then `grep -rn "resolveAiConfig\|resolveEmbeddingConfig" apps packages --include="*.ts" | grep -v dist | grep "import"` → no matches importing them from `@askdb/ai`.

### Step 6: Migrate the tests

- `packages/ai/src/provider.test.ts`: rewrite against the new surface. Universal-precedence tests (ASKDB_AI_API_KEY beats native, secondary ordering, ASKDB_AI_MODEL/ASKDB_MODEL ordering, ASKDB_AI_BASE_URL override, "returns undefined with no key") now exercise `resolveBaseConfig` directly with an inline `ProviderEnvSpec` fixture, plus registry tests using fake adapters (existing fake-adapter tests in that file show the pattern). Add new registry tests: alias lookup (`ASKDB_AI_PROVIDER=foundry` selects an adapter with `aliases: ["foundry"]`), unknown provider error lists registered names, default-to-openai when unset, `resolveAiConfig`/`resolveEmbeddingConfig` registry methods delegate with the right `usage`.
- Provider-specific resolution tests (the azure resourceName/apiVersion/validation cases and google key cases currently in `provider.test.ts`) move to `packages/ai-azure/src/index.test.ts` and `packages/ai-google/src/index.test.ts` as `resolveConfig` tests. Azure must keep: native-key selection, `OPENAI_API_KEY` ignored under azure, throws without baseURL/resourceName, resourceName/apiVersion land in `providerOptions`. Google must add: default model is `gemini-2.0-flash`, embedding resolution without a model var throws, `OPENAI_API_KEY_SECONDARY` is NOT used.
- `packages/ai-azure/src/index.test.ts` / `ai-openai` model-construction tests: update config literals (azure ones move `resourceName`/`apiVersion` under `providerOptions`).

**Verify**: `pnpm --filter @askdb/ai --filter @askdb/ai-openai --filter @askdb/ai-azure --filter @askdb/ai-google test` → all pass.

### Step 7: Normalize the `ai` dependency declarations

- `packages/ai/package.json`: move `ai` from `dependencies` to `peerDependencies: { "ai": "^6.0.0" }`; add `"ai": "^6.0.200"` to `devDependencies`.
- `packages/ai-openai`, `ai-azure`, `ai-google`: `peerDependencies: { "ai": "^6.0.0", "@askdb/ai": "workspace:^" }`; move `@askdb/ai` out of `dependencies`; add `"ai": "^6.0.200"` and `"@askdb/ai": "workspace:*"` to `devDependencies`. Keep `@ai-sdk/*` as regular `dependencies`. (pnpm rewrites `workspace:^` to a real semver range on publish.)
- Consumers must now satisfy the peers explicitly: add `"ai": "^6.0.200"` to `dependencies` of `apps/cli`, `apps/http-api`, and `packages/tui` (`apps/studio` already has it). They all keep their `@askdb/ai` dependency, which satisfies that peer.

Run `pnpm install` to refresh the lockfile.

**Verify**: `pnpm install` → exit 0 with no unmet-peer warnings mentioning `@askdb/ai-*`; `pnpm build && pnpm lint && pnpm test` → exit 0.

### Step 8: Changeset and READMEs

- Create `.changeset/ai-adapter-contract-v2.md` with minor bumps for `@askdb/ai`, `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `askdb`, `@askdb/http-api`, `@askdb/studio`, `@askdb/tui` (format: see `.changeset/add-google-gemini-provider.md`). Body must state: standalone `resolveAiConfig`/`resolveEmbeddingConfig` moved onto the registry; `AiConfig.resourceName`/`apiVersion` replaced by `providerOptions`; `ai` is now a peer dependency of the AI packages; the three google behavior changes from Step 4.
- Skim `packages/ai/README.md` and the three adapter READMEs for code samples that import the removed standalone functions; update any to the registry methods.

**Verify**: `ls .changeset/ai-adapter-contract-v2.md` → exists; `grep -rn "resolveAiConfig" packages/ai/README.md packages/ai-*/README.md` → only registry-method usage shown.

### Step 9: Full gate

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0. Then `pnpm smoke:install` → exit 0 (this packs tarballs and installs them outside the workspace — it is the test that actually exercises the new peer-dependency declarations).

## Test plan

- New/updated unit tests per Step 6, all under the existing files (`provider.test.ts`, three adapter `index.test.ts`). Model new adapter tests on `packages/ai-openai/src/index.test.ts` (`vi.hoisted` + `vi.mock` of the `@ai-sdk/*` package and `ai`).
- Named cases that must exist when done: alias selection (`foundry` → azure adapter), unknown-provider error message lists registered providers, google default model `gemini-2.0-flash`, google embedding-model-missing throws, azure `providerOptions` carry `resourceName`/`apiVersion`, universal key precedence (4-level), `usage: "embedding"` model precedence including `modelEnvVar`.
- Verification: `pnpm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `pnpm smoke:install` exits 0
- [ ] `grep -n '"openai" | "azure" | "google"' packages/ai/src/provider.ts` → no matches (open provider type)
- [ ] `grep -n "AZURE_\|GOOGLE_\|OPENAI_" packages/ai/src/provider.ts` → no matches (no provider env vars left in `@askdb/ai`; `ASKDB_AI_*` vars are fine)
- [ ] `grep -n "resourceName\|apiVersion" packages/ai/src/provider.ts` → no matches
- [ ] `python3 -c "import json; d=json.load(open('packages/ai-google/package.json')); assert 'ai' in d.get('peerDependencies',{})"` → exit 0, and same for `ai-openai`, `ai-azure`; `@askdb/ai` has `ai` in `peerDependencies`, not `dependencies`
- [ ] `.changeset/ai-adapter-contract-v2.md` exists and names all eight bumped packages
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows in-scope files changed and the "Current state" excerpts no longer match.
- `pnpm smoke:install` fails on peer resolution after Step 7 — the peer strategy may need `peerDependenciesMeta` or pnpm config; report the exact error rather than reverting to hard deps silently.
- You find additional production callers of the standalone `resolveAiConfig`/`resolveEmbeddingConfig` beyond the five listed call sites (`grep` before deleting).
- Making `AiProvider` a string breaks a consumer type outside the in-scope list (e.g. something in `packages/config` pattern-matches the union).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `packages/config/src/types.ts` + `flatten.ts` still hold a per-provider discriminated union for `askdb.config.*` authoring (openai/azure/foundry/google branches with defaults like `DEFAULT_GOOGLE_CHAT_MODEL`). That coupling is intentional for now: config flattens to env keys; adapters read env keys. Adding a provider needs an adapter package and, only for `askdb.config` authoring support, a config branch (see plan 004 for anthropic). A future ADR could make config provider-agnostic.
- `AiConfig.apiKey` remains required. AWS Bedrock (SigV4 auth, no API key) will need `apiKey` to become optional — deferred; see plans/README "considered and rejected".
- Reviewer scrutiny: the precedence-order code in `resolveBaseConfig` is the highest-risk diff — compare it line-by-line against the table in "Current state".
- Plans 002 and 004 build on the contract introduced here.
