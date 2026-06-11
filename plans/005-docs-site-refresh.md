# Plan 005: Update the docs-site to match the post-adapter-contract AI architecture

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 154b17e..HEAD -- apps/docs-site/src/content/docs apps/docs-site/astro.config.mjs`
> Locate content by heading/section, not line number — these pages may have
> drifted. Plans 001–004 are expected to be merged; verify their changes exist
> (see Prerequisite check in Step 0) before editing prose that describes them.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-ai-adapter-contract-v2.md (hard), plans/004-anthropic-adapter-and-registry-messages.md (hard), plans/003-architecture-docs-refresh.md (soft — repo docs land first so the site can mirror them)
- **Category**: docs
- **Planned at**: commit `154b17e`, 2026-06-11

## Why this matters

The docs-site (`apps/docs-site`, Astro Starlight, deployed to GitHub Pages) is hand-authored — it does **not** auto-mirror `docs/*.md`, so plan 003's repo-doc fixes do not reach it. After plans 001 and 004 land, the site is wrong in both directions: `reference/packages.mdx` documents `resolveAiConfig` / `resolveEmbeddingConfig` as standalone `@askdb/ai` exports (removed by 001 — now registry methods), while `reference/config.mdx` and `quickstart.mdx` already advertise `ai.provider = "anthropic"` — which was *false* at the time of writing (the config flattener threw) and becomes true only once 004 lands. The BYO-model guide also pins a retired Anthropic model id (`claude-3-5-sonnet-latest`). The site is the first thing new users read; it must not contradict the published packages.

## Current state

Verified at `154b17e`. The site is `apps/docs-site` (`@askdb/docs-site`): Astro 6 + Starlight, content in `src/content/docs/**/*.mdx`, sidebar defined in `astro.config.mjs` (lines 85–134). Pages that mention AI providers/packages (found by grep for `askdb/ai|ASKDB_AI_PROVIDER|OPENAI_API_KEY|anthropic|adapter`):

- `src/content/docs/reference/packages.mdx`
  - Line 47: table row — `` `resolveAiConfig` / `resolveEmbeddingConfig` | Resolve provider config without constructing a model.`` → **stale after 001** (standalone exports removed; they are registry methods now).
  - Lines 50–57: "Provider adapters" section with `npm install @askdb/ai-openai|-azure|-google` → add `@askdb/ai-anthropic` after 004; note the `ai` peer dependency introduced by 001.
- `src/content/docs/reference/config.mdx`
  - Line 22: example uses `env("OPENAI_API_KEY")` — fine.
  - Line 76: row — `` `ANTHROPIC_API_KEY` | `ai.providerConfig.anthropic.apiKey` | When `ai.provider = "anthropic"`.`` → premature today; correct after 004. Also: no documentation of the custom-provider branch (004 Step 5: unknown provider strings flatten to universal `ASKDB_AI_*` keys; requires a registered adapter).
- `src/content/docs/quickstart.mdx`
  - Line 14: prerequisites mention "OpenAI, Anthropic, Google, OpenRouter, or any AI-SDK compatible provider" — fine after 004.
  - Line 42: `provider: "openai",   // or "anthropic", "google", etc.` — the "etc." is honest only once the custom-provider branch exists (004); keep, but ensure the comment matches what config actually accepts.
- `src/content/docs/guides/bring-your-own-model.mdx`
  - Line 56–65: Anthropic section — `npm install ai @ai-sdk/anthropic`, `const model = anthropic("claude-3-5-sonnet-latest");` → **outdated model id**; current ids include `claude-sonnet-4-6` (Sonnet 4.6), `claude-opus-4-8`, `claude-haiku-4-5-20251001`. Use `claude-sonnet-4-6`.
- `src/content/docs/install.mdx`
  - Lines 52–54: "Optional: AskDB config/env model factory and matching provider adapter — `npm install @askdb/ai` / `@askdb/ai-openai`" — add a line showing the adapter choice includes anthropic; mention the `ai` peer.
- `src/content/docs/guides/deploy-as-http-service.mdx`
  - Line 31: env-var prose ("`OPENAI_API_KEY`, etc.") — fine; touch only if 004 changed the recommended env story.

Commands and conventions:

- `pnpm -C apps/docs-site lint` → `astro check`.
- `pnpm --filter @askdb/docs-site test` → builds with `ASTRO_BASE=/AskDB` and runs `scripts/check-base-links.mjs` (link checker). This is the page-level gate.
- Root `pnpm docs:build` builds the site.
- MDX with Starlight components; root-absolute internal links (e.g. `/guides/bring-your-own-model/`) are rebased automatically by the remark plugin in `astro.config.mjs` — keep using root-absolute links.
- The repo-level docs (`docs/integration/installable-package.md` etc.) remain canonical; site pages summarize and link out via `editLink`-style GitHub URLs where they already do.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Site typecheck | `pnpm -C apps/docs-site lint` | exit 0 |
| Site build + link check | `pnpm --filter @askdb/docs-site test` | exit 0 |
| Root docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:

- `apps/docs-site/src/content/docs/reference/packages.mdx`
- `apps/docs-site/src/content/docs/reference/config.mdx`
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/src/content/docs/install.mdx`
- `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`
- `apps/docs-site/src/content/docs/guides/deploy-as-http-service.mdx` (only if needed)
- `apps/docs-site/astro.config.mjs` (only if a new page is added — not expected)

**Out of scope**:

- Repo-level docs (`docs/**`, `README.md`) — plans 003/004 own those.
- Any source code or package.json outside the docs-site.
- Restructuring the site, adding new guides, or styling — content corrections only.
- `.changeset/` — the docs-site is private/unpublished; check `git log` precedent for docs-site-only commits and follow it (expected: no changeset).

## Git workflow

- Branch: `advisor/005-docs-site-refresh`.
- Commit style: `docs(site): …`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Prerequisite check

Confirm the architecture the prose will describe actually exists:

```bash
grep -rn "keyMissingMessage\|resolveBaseConfig" packages/ai/src/provider.ts   # both present (001/004)
ls packages/ai-anthropic/src/index.ts                                          # exists (004)
grep -n "is not supported yet" packages/config/src/flatten.ts                  # NO matches (004)
```

**Verify**: all three checks pass; otherwise STOP.

### Step 1: `reference/packages.mdx`

- Replace the `resolveAiConfig` / `resolveEmbeddingConfig` table row: these are now
  **registry methods** — e.g. `` `registry.resolveAiConfig(env)` / `registry.resolveEmbeddingConfig(env)` | Resolve provider config from env without constructing a model. `` Also confirm the `createAiRegistry` row and any code snippet on the page matches the live `packages/ai/src/index.ts` exports (read the file; add `resolveBaseConfig` / `withEmbeddingProviderOptions` rows only if the page's table aims to be exhaustive — match its existing depth).
- "Provider adapters" install list: add `npm install @askdb/ai-anthropic`; add one sentence noting adapters declare `ai` and `@askdb/ai` as peer dependencies (installed automatically by npm/pnpm; your app should depend on `ai` directly when it pins the version).
- Mention the open contract in one line: any provider with an AI SDK package can be added as an adapter; unknown `ASKDB_AI_PROVIDER` values require a registered adapter.

**Verify**: `grep -n "resolveAiConfig" apps/docs-site/src/content/docs/reference/packages.mdx` → only registry-method form remains.

### Step 2: `reference/config.mdx`

- Keep the `ANTHROPIC_API_KEY` row (now true); confirm its wording matches 004's flatten behavior (`ai.providerConfig.anthropic.apiKey`, default model `claude-sonnet-4-6`).
- Add a short "Custom providers" subsection documenting the generic branch from 004 Step 5: `ai.provider` accepts any string; unknown strings flatten `providerConfig.custom.{apiKey,baseUrl,model}` to `ASKDB_AI_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL`; works only when the consuming registry has an adapter registered under that name — first-party apps register openai/azure/google/anthropic; for anything else, embed AskDB and register your own adapter, or use an OpenAI-compatible endpoint via the `openai` provider + base URL. Read `packages/config/src/types.ts` (post-004) and quote the real field names.

**Verify**: `pnpm -C apps/docs-site lint` → exit 0; the section's field names match `packages/config/src/types.ts`.

### Step 3: `guides/bring-your-own-model.mdx` and `quickstart.mdx`

- Update the Anthropic snippet's model id to `claude-sonnet-4-6` (verify the id is still
  current — check the `claude-api` skill or Anthropic docs if available in your
  environment; do not invent ids).
- Skim the whole BYO guide for other retired model ids (OpenAI/Google) and update them to the defaults the adapters use (`gpt-4o-mini`, `gemini-2.0-flash`).
- `quickstart.mdx` line ~42: align the provider comment with reality — known literals `"openai" | "azure" | "foundry" | "google" | "anthropic"` plus custom strings; keep it to a comment-length hint and link to `/reference/config/` for the custom-provider details.

**Verify**: `grep -rn "claude-3-5" apps/docs-site/src/content/docs` → no matches.

### Step 4: `install.mdx` (and `deploy-as-http-service.mdx` if needed)

- In the optional model-factory block (lines ~52–54), show the adapter list as a choice: `npm install @askdb/ai @askdb/ai-openai` with a comment naming `-azure`, `-google`, `-anthropic` as alternatives.
- `deploy-as-http-service.mdx`: only touch if its env-var prose contradicts post-004 behavior (it currently says "`OPENAI_API_KEY`, etc." — likely fine).

**Verify**: `grep -n "ai-anthropic" apps/docs-site/src/content/docs/install.mdx` → present.

### Step 5: Full gate

**Verify**: `pnpm -C apps/docs-site lint && pnpm --filter @askdb/docs-site test && pnpm docs:build` → all exit 0 (the `test` script catches broken internal links under the GitHub Pages base path).

## Test plan

Docs-only. Gates: `astro check`, the base-path link checker (`pnpm --filter @askdb/docs-site test`), and the grep assertions in each step. No unit tests.

## Done criteria

- [ ] `pnpm -C apps/docs-site lint`, `pnpm --filter @askdb/docs-site test`, `pnpm docs:build` all exit 0
- [ ] `grep -rn "claude-3-5" apps/docs-site/src/content/docs` → no matches
- [ ] `reference/packages.mdx` shows registry-method resolution and lists `@askdb/ai-anthropic`
- [ ] `reference/config.mdx` documents the custom-provider branch with field names matching `packages/config/src/types.ts`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 0 prerequisite checks fail (001/004 not merged) — the prose would describe a future that may still change.
- The live `packages/config/src/types.ts` custom-provider field names differ from what plan 004 specified (e.g. no `providerConfig.custom`) — document what exists, and if it's ambiguous, stop and report rather than guessing.
- The link checker fails on links you did not touch — report; do not fix unrelated pages in this plan.

## Maintenance notes

- The docs-site duplicates facts that live in repo docs and package READMEs; any future provider addition must touch `reference/packages.mdx`, `reference/config.mdx`, and `install.mdx` — the `new-ai-adapter` skill (`.claude/skills/new-ai-adapter/SKILL.md`) includes this in its Step 5, so keep that skill in sync if the site structure changes.
- Consider (deferred, not in scope) generating the package list on `reference/packages.mdx` from `packages/*/package.json` at build time to end the drift class entirely.
