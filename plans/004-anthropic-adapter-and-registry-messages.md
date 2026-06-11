# Plan 004: Add `@askdb/ai-anthropic`, open the config provider union, make the key-missing message registry-driven, and settle the surfaces policy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 154b17e..HEAD -- packages/ai packages/ai-openai packages/ai-azure packages/ai-google packages/config apps packages/tui examples/installable-smoke/run.sh docs/integration/installable-package.md`
> Plans 001–003 intentionally change several of these; this plan is written
> against the post-001 contract. If plan 001 is not merged, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW–MED
- **Depends on**: plans/001-ai-adapter-contract-v2.md (hard), plans/003-architecture-docs-refresh.md (soft — docs edits stack)
- **Category**: direction
- **Planned at**: commit `154b17e`, 2026-06-11

## Why this matters

This is the payoff step for the adapter architecture. (1) AskDB's config-driven path supports OpenAI, Azure, and Google but cannot select Anthropic Claude — `packages/config/src/flatten.ts:94-95` literally throws `"Anthropic AI provider is not supported yet."` Post-001, an Anthropic adapter is ~40 lines and proves the open adapter contract works end to end. (2) `aiKeyMissingMessage` in `@askdb/ai` hard-codes per-provider setup instructions for exactly three providers; once adapters are self-describing, that text should be assembled from the registered adapters so it can never drift (and automatically mentions Anthropic). (3) The TUI's help text hard-codes provider hints the same way. The "should surfaces hard-depend on all adapters" question is settled as **yes, batteries-included** (the standalone `askdb-tui` binary requires it; plan 003 documents the policy) — this plan just wires the new adapter into all four surfaces consistently. (4) Post-001, the runtime adapter contract is open (`AiProvider` is a string and hosts can register custom adapters), but `askdb.config.*` still only accepts the closed literal union of first-party providers — the config layer must not be more closed than the runtime beneath it. This plan opens it: known literals keep autocomplete and rich per-provider branches; any other string flattens to the universal `ASKDB_AI_*` keys, which `resolveBaseConfig` already honors for any registered adapter. (A custom string only works end to end when the host's registry actually contains an adapter with that name — the first-party apps register only first-party adapters; document that.)

## Current state

(At `154b17e`; adjust to post-001 reality — adapters have `resolveConfig`, `aliases`, and `@askdb/ai` exports `resolveBaseConfig` / `ProviderEnvSpec`.)

- `packages/ai/src/provider.ts:310-321` — `aiKeyMissingMessage(context)` returns one static string covering OpenAI, Azure/Foundry, and Google. Callers: `apps/studio/src/server.ts:356,370,479`, `apps/http-api/src/server.ts:255`, `apps/cli/src/cli.ts:327`.
- `packages/config/src/types.ts:46-47` — `export type AnthropicConfig = Record<string, never>; // Placeholder`; lines 83-87 — `AnthropicAiConfig` branch marked "not yet supported; flattenAskDbConfig throws".
- `packages/config/src/flatten.ts:94-96` — `} else if (config.ai.provider === "anthropic") { throw new Error("askdb.config: Anthropic AI provider is not supported yet."); }`. Flatten helpers for other providers (`applyOpenAiAi`, `applyGoogleAi` at lines 32-45) write native env keys plus `ASKDB_AI_MODEL`; defaults come from `packages/config/src/defaults.ts` (`DEFAULT_GOOGLE_CHAT_MODEL = "gemini-2.0-flash"` etc.).
- Registry construction (`createAiRegistry([openaiProvider, azureProvider, googleProvider])`) in: `apps/cli/src/cli.ts:36`, `apps/http-api/src/server.ts:35`, `apps/studio/src/server.ts:79`, `packages/tui/src/cli.ts:15`. Each app's package.json depends on the three adapter packages.
- `packages/tui/src/cli.ts:150-153` — help text hard-codes OpenAI/Azure env hints.
- `examples/installable-smoke/run.sh:24` — explicit list of packages to pack (`packages/ai packages/ai-openai packages/ai-azure packages/ai-google …`); a new package must be added here or the smoke test won't cover it.
- Template for a new adapter package: `packages/ai-google/` — files `package.json`, `tsconfig.json`, `tsconfig.build.json` (`{ "extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts", …] }`), `README.md`, `src/index.ts`, `src/index.test.ts`. Its package.json includes full metadata (description, keywords, repository.directory, license Apache-2.0, author, `type: module`, dist exports, files, engines, the standard build/lint/test scripts). Copy this structure exactly, adjusting names.
- Anthropic facts: native env var convention `ANTHROPIC_API_KEY`; AI SDK provider package `@ai-sdk/anthropic` (same family as the `^3.x` `@ai-sdk/openai`/`azure`/`google` already used); Anthropic has **no embeddings API**. Current model ids include `claude-sonnet-4-6` (Sonnet 4.6), `claude-opus-4-8` (Opus 4.8), `claude-haiku-4-5-20251001` (Haiku 4.5). Use `claude-sonnet-4-6` as the default chat model.
- Repo conventions: changesets for releases, conventional commits, vitest with `vi.mock` of SDK packages (exemplar: `packages/ai-openai/src/index.test.ts`), config flatten tests live in `packages/config/src` (find with `ls packages/config/src/*.test.ts`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Check latest SDK version | `npm view @ai-sdk/anthropic version` | a `3.x` version (see STOP conditions) |
| Install | `pnpm install` | exit 0 |
| Build / lint / test all | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Test one pkg | `pnpm --filter @askdb/ai-anthropic test` | pass |
| Smoke | `pnpm smoke:install` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Suggested executor toolkit

- If a `claude-api` skill/reference is available in your environment, consult it to confirm current Anthropic model ids before hard-coding the default; otherwise trust the ids listed above.

## Scope

**In scope**:

- `packages/ai-anthropic/**` (create: package.json, tsconfig.json, tsconfig.build.json, README.md, src/index.ts, src/index.test.ts)
- `packages/ai/src/provider.ts` + `index.ts` + `provider.test.ts` (configHint mechanism, deprecate static message)
- `packages/config/src/types.ts`, `flatten.ts`, `defaults.ts` + their tests (anthropic branch)
- `apps/cli/{src/cli.ts,package.json}`, `apps/http-api/{src/server.ts,package.json}`, `apps/studio/{src/server.ts,package.json}`, `packages/tui/{src/cli.ts,package.json}` (register adapter; message call sites; TUI help text)
- `examples/installable-smoke/run.sh` (add package to pack list)
- `docs/integration/installable-package.md` (Anthropic recipe), `README.md`/`docs/platform.md` (restore "Anthropic" to the recipe claim), `docs/architecture.md` (add the node/row per plan 003's convention)
- `.changeset/<new-file>.md` (create)

**Out of scope**:

- Bedrock adapter — blocked on making `AiConfig.apiKey` optional (SigV4 auth); deliberately deferred, see plans/README.
- RAG/embedding support for Anthropic — no embeddings API exists; the adapter must throw a clear error instead.
- Removing `aiKeyMissingMessage` — deprecate only; removal is a 1.0 decision.

## Git workflow

- Branch: `advisor/004-anthropic-adapter`.
- Conventional commits, e.g. `feat(ai): add @askdb/ai-anthropic provider adapter`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `packages/ai-anthropic`

Copy the `packages/ai-google` structure. `package.json`: name `@askdb/ai-anthropic`, version `0.1.0-beta.0`, description "AskDB Anthropic Claude provider adapter for @askdb/ai.", keywords incl. `anthropic`/`claude`, `repository.directory: "packages/ai-anthropic"`; dependencies `{ "@ai-sdk/anthropic": "^<latest 3.x from npm view>" }`; peers/devDeps mirroring the post-001 adapters (`ai` + `@askdb/ai` peers, devDeps `ai`, `@askdb/ai workspace:*`, typescript, vitest).

`src/index.ts`:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveBaseConfig, type AiProviderAdapter, type ProviderEnvSpec } from "@askdb/ai";

const ENV_SPEC: ProviderEnvSpec = {
  apiKeyVars: ["ANTHROPIC_API_KEY"],
  modelVars: ["ANTHROPIC_MODEL"],
  baseURLVars: ["ANTHROPIC_BASE_URL"],
  defaultModel: "claude-sonnet-4-6",
};

export const anthropicProvider: AiProviderAdapter = {
  provider: "anthropic",
  configHint:
    "For Anthropic Claude, set ASKDB_AI_PROVIDER=anthropic plus ANTHROPIC_API_KEY (or ASKDB_AI_API_KEY).",
  resolveConfig(env, options) {
    return resolveBaseConfig("anthropic", env, ENV_SPEC, options);
  },
  createLanguageModel(config) {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return anthropic(config.model);
  },
  createEmbeddingModel() {
    throw new Error(
      "Anthropic does not provide an embeddings API. Configure a different embedding provider " +
        "(e.g. ASKDB_RAG_EMBEDDER with OpenAI) while using Anthropic for chat.",
    );
  },
};
```

(`configHint` is added to the adapter type in Step 3 — if you build this package first, expect a transient type error until then; order Steps 1–3 within one commit.)

`src/index.test.ts` modeled on `packages/ai-openai/src/index.test.ts`: mock `@ai-sdk/anthropic`; assert provider id, language-model construction with apiKey/baseURL, `createEmbeddingModel` throws with a message containing "embeddings", `resolveConfig` resolves `ANTHROPIC_API_KEY` and defaults the model to `claude-sonnet-4-6`. Write a short README mirroring `packages/ai-google/README.md`.

**Verify**: `pnpm install && pnpm --filter @askdb/ai-anthropic build` → exit 0 (tests after Step 3).

### Step 2: Wire the adapter into the four surfaces and the smoke script

- Add `"@askdb/ai-anthropic": "workspace:*"` to dependencies of `apps/cli`, `apps/http-api`, `apps/studio`, `packages/tui`.
- In each of the four registry construction sites, import `anthropicProvider` and extend the array: `createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider])`.
- `examples/installable-smoke/run.sh:24`: add `packages/ai-anthropic` to the pack list (after `packages/ai-google`).

**Verify**: `pnpm build` → exit 0; `grep -rln "anthropicProvider" apps packages/tui/src` → 4 files.

### Step 3: Registry-driven key-missing message (B4)

In `packages/ai/src/provider.ts`:

- Add `configHint?: string` to `AiProviderAdapter`.
- Add a registry method `keyMissingMessage(context: string): string` that returns `` `${context}: no AI API key configured. ` `` followed by the `configHint` of every registered adapter (deduplicated — alias entries point at the same adapter object; join with a space, stable registration order). Adapters without a hint are skipped. If no adapter has a hint, fall back to the existing static `aiKeyMissingMessage(context)` body.
- Give the three existing adapters their hints, lifted verbatim from today's static message: openai → "For OpenAI, set OPENAI_API_KEY (or ASKDB_AI_API_KEY)."; azure → "For Azure / Microsoft Foundry, set ASKDB_AI_PROVIDER=azure plus AZURE_OPENAI_API_KEY (or ASKDB_AI_API_KEY), ASKDB_AI_AZURE_RESOURCE_NAME (or ASKDB_AI_BASE_URL), and a deployment name via ASKDB_AI_MODEL."; google → "For Google Gemini, set ASKDB_AI_PROVIDER=google plus GOOGLE_GENERATIVE_AI_API_KEY (or ASKDB_AI_API_KEY)."
- Mark the standalone `aiKeyMissingMessage` export `@deprecated Use AiRegistry.keyMissingMessage(context).` Keep it exported.
- Switch the five call sites (`apps/studio/src/server.ts:356,370,479`, `apps/http-api/src/server.ts:255`, `apps/cli/src/cli.ts:327`) to `ai.keyMissingMessage(...)` and drop the now-unused imports.

Tests in `packages/ai/src/provider.test.ts`: message includes each registered adapter's hint exactly once (register an adapter with an alias to prove dedup); fallback path when no hints.

**Verify**: `pnpm --filter @askdb/ai test` → pass; `grep -rn "aiKeyMissingMessage" apps --include="*.ts"` → no matches.

### Step 4: Config-package support for `ai.provider: "anthropic"`

- `packages/config/src/defaults.ts`: add `export const DEFAULT_ANTHROPIC_CHAT_MODEL = "claude-sonnet-4-6";`
- `packages/config/src/types.ts`: replace the placeholder — `export type AnthropicConfig = { apiKey?: string; baseUrl?: string; model?: string; };` and update the `AnthropicAiConfig` branch JSDoc (no longer "not yet supported").
- `packages/config/src/flatten.ts`: replace the throw with `applyAnthropicAi(out, config.ai.providerConfig.anthropic)` that sets `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `ASKDB_AI_MODEL` (model default `DEFAULT_ANTHROPIC_CHAT_MODEL`), mirroring `applyGoogleAi` (lines 40-45) exactly in style.
- Update/extend the config flatten tests (locate via `grep -rln "flattenAskDbConfig" packages/config/src --include="*.test.ts"`): the anthropic branch flattens correctly; the old "throws" test is replaced.

**Verify**: `pnpm --filter @askdb/config test` → pass.

### Step 5: Open the config provider union for custom adapters

Make `askdb.config.*` accept any provider string while keeping autocomplete and the rich
branches for first-party providers. In `packages/config/src/types.ts`:

- Add a generic branch type:

```ts
/** Generic connection settings for a provider AskDB has no dedicated branch for.
 *  Flattened to the universal ASKDB_AI_* keys; works end to end only when the
 *  consuming registry has an adapter registered under this provider name. */
export type CustomProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

/** Branch for custom/third-party providers. `(string & {})` preserves literal
 *  autocomplete for the known providers while accepting any other string. */
export type CustomAiConfig = {
  provider: string & {};
  providerConfig?: { custom?: CustomProviderConfig };
};
```

- Append `CustomAiConfig` to the `AskDbAiConfig` union **last** (TypeScript narrows the
  known literals to their dedicated branches first; only unknown strings fall through).
  Verify in an editor/test that `provider: "openai"` still requires `providerConfig.openai`
  — if union ordering does not achieve that, use `Exclude`-style typing
  (`provider: Exclude<string, KnownAiProvider> & {}` is not expressible; instead keep the
  known-literal branches and type the custom branch's provider as `string & {}` — the
  discriminated union resolves exact literals to the specific branches as long as those
  branches are declared first; see STOP conditions).

In `packages/config/src/flatten.ts`, replace the final `else if`/throw chain tail with a
generic fallback for any provider string not matched by the known branches:

```ts
} else {
  // Custom/third-party provider: flatten to the universal ASKDB_AI_* keys that
  // @askdb/ai's resolveBaseConfig honors for every registered adapter.
  set(out, "ASKDB_AI_PROVIDER", config.ai.provider);
  const custom = config.ai.providerConfig?.custom;
  set(out, "ASKDB_AI_API_KEY", custom?.apiKey);
  set(out, "ASKDB_AI_BASE_URL", custom?.baseUrl);
  set(out, "ASKDB_AI_MODEL", custom?.model);
}
```

Add flatten tests: a custom provider string (e.g. `"mistral"`) flattens to
`ASKDB_AI_PROVIDER=mistral` plus the three universal keys; known providers are unaffected;
an empty custom `providerConfig` still sets `ASKDB_AI_PROVIDER`. Add a JSDoc note (and a
line in `docs/integration/installable-package.md` in Step 6) stating the three-tier model:
known provider literal (zero code) → custom provider string + a host-registered adapter
(~40 lines) → BYO `LanguageModel` via `ask({ model })` (no config involvement; a model
instance cannot be serialized through config).

**Verify**: `pnpm --filter @askdb/config test` → pass, including the new custom-provider
cases; `grep -n "is not supported yet" packages/config/src/flatten.ts` → no matches.

### Step 6: TUI help text and docs (B5 remainder + recipes)

- `packages/tui/src/cli.ts:150-153`: keep it short — replace the provider-specific lines with: "AI suggestions are enabled when an AI API key is configured (ASKDB_AI_API_KEY, or a provider-native key such as OPENAI_API_KEY / ANTHROPIC_API_KEY). Select the provider with ASKDB_AI_PROVIDER (openai, azure, google, anthropic); override the model with ASKDB_AI_MODEL."
- `docs/integration/installable-package.md`: add an Anthropic recipe section (env-only: `ASKDB_AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`, optional `ASKDB_AI_MODEL=claude-sonnet-4-6`; and the `askdb.config.ts` `providerConfig.anthropic` form; note the no-embeddings caveat for RAG). Follow the formatting of the existing provider sections in that file.
- `README.md` / `docs/platform.md`: re-add "Anthropic" to the recipe claim sentence (which plan 003 trimmed to match reality).
- `docs/architecture.md`: add the `@askdb/ai-anthropic` node to both mermaid diagrams and a row to the package table, following whatever shape plan 003 established.

**Verify**: `pnpm docs:build` → exit 0; `grep -rn -i "anthropic" docs/integration/installable-package.md` → recipe present.

### Step 7: Changeset and full gate

`.changeset/add-anthropic-provider.md`: minor bumps for `@askdb/ai-anthropic` (new), `@askdb/ai`, `@askdb/config`, `askdb`, `@askdb/http-api`, `@askdb/studio`, `@askdb/tui`; patch for `@askdb/ai-openai`/`ai-azure`/`ai-google` (configHint added). Body modeled on `.changeset/add-google-gemini-provider.md`; it must also describe the new custom-provider config branch (Step 5) and its "requires a registered adapter" caveat.

**Verify**: `pnpm build && pnpm lint && pnpm test` → exit 0; `pnpm smoke:install` → exit 0.

## Test plan

- `packages/ai-anthropic/src/index.test.ts` (new): provider id, model construction, baseURL forwarding, embeddings throw, `resolveConfig` happy path + default model + returns undefined without a key. Pattern: `packages/ai-openai/src/index.test.ts`.
- `packages/ai/src/provider.test.ts`: `keyMissingMessage` composition, dedup across aliases, fallback.
- `packages/config` flatten tests: anthropic branch (key, baseUrl, model default, `ASKDB_AI_PROVIDER=anthropic`); custom-provider branch (`"mistral"` → universal `ASKDB_AI_*` keys; known literals unaffected).
- `packages/config` type-level check (compile-time test or `tsd`-style assertion in an existing test file): `provider: "openai"` still requires the `openai` branch; `provider: "mistral"` compiles with the custom branch.
- Verification: `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm docs:build` all exit 0
- [ ] `ASKDB_AI_PROVIDER=anthropic` path: `grep -n "anthropic" packages/config/src/flatten.ts` shows the apply branch, not a throw
- [ ] `grep -n "is not supported yet" packages/config/src/flatten.ts` → no matches; custom-provider flatten tests exist and pass
- [ ] `grep -rln "anthropicProvider" apps packages/tui/src` → 4 registry sites
- [ ] `grep -rn "aiKeyMissingMessage" apps --include="*.ts"` → no matches (all on registry method)
- [ ] `grep -n "ai-anthropic" examples/installable-smoke/run.sh` → present in pack list
- [ ] `.changeset/add-anthropic-provider.md` exists
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 001 not merged (no `resolveBaseConfig` in `@askdb/ai`).
- `npm view @ai-sdk/anthropic version` returns a major other than 3, or the package's `createAnthropic` API differs from the `createGoogleGenerativeAI` pattern (check its README via `npm view @ai-sdk/anthropic readme | head -80`) — report the actual API instead of guessing.
- The post-001 `AiProviderAdapter` type differs materially from what Step 3 assumes (e.g. `configHint` already exists or messages were already reworked).
- The `(string & {})` union in Step 5 breaks narrowing for the known literals (i.e. `provider: "openai"` no longer forces `providerConfig.openai`, or existing `askdb.config.ts` fixtures fail to typecheck). Report the observed TypeScript behavior with a minimal repro instead of loosening the known-provider branches.
- Studio's RAG flow breaks when `ASKDB_AI_PROVIDER=anthropic` in a way a clear error doesn't cover (e.g. an unhandled throw crashes the server rather than returning a 4xx) — report; do not bolt on embedding fallbacks.

## Maintenance notes

- Default model `claude-sonnet-4-6` will age; it lives in exactly two places (`packages/ai-anthropic/src/index.ts` ENV_SPEC and `packages/config/src/defaults.ts`) — keep them in sync when bumping.
- Bedrock remains the known follow-up that forces `AiConfig.apiKey` to become optional; whoever does it should also revisit `resolveBaseConfig`'s "no key → undefined" rule for credential-provider-based auth.
- Reviewer scrutiny: the `keyMissingMessage` dedup across alias registrations, and that the anthropic embeddings error surfaces as a friendly 4xx in Studio/HTTP API rather than a 500 crash.
