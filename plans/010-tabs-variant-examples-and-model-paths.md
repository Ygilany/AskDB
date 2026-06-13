# Plan 010: Variant-heavy pages use synced Tabs, and the two model-wiring paths are explained together

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bd751df..HEAD -- apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx apps/docs-site/src/content/docs/guides/switch-engines.mdx apps/docs-site/src/content/docs/install.mdx apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/009-quickstart-fast-path.md (soft — keeps docs PRs sequential; no file overlap)
- **Category**: docs
- **Planned at**: commit `bd751df`, 2026-06-12

## Why this matters

Two related problems hurt readers who arrive with a specific stack:

1. **No tabs anywhere.** The site never uses Starlight's `<Tabs>` component
   (verified: zero matches for `Tabs|TabItem` across `src/content`). Pages
   that cover per-provider or per-engine variants stack them as sequential
   sections, so an Anthropic-on-MySQL reader scrolls through OpenAI and
   Postgres material on every page. Starlight tabs support `syncKey`, which
   persists the reader's choice across the whole site.
2. **The two ways to wire a model are never presented together.** The
   Quickstart and Configuration reference teach the *config-driven* path
   (`ai.provider` in `askdb.config.ts`, consumed by the CLI/Studio/HTTP
   surfaces through `@askdb/ai-*` adapters). The "Bring your own model" guide
   teaches only the *direct* path (pass any Vercel AI SDK `LanguageModel` to
   `ask()`) and never mentions `@askdb/ai` at all. A reader who starts in the
   Quickstart and then opens this guide sees two disjoint APIs with no bridge.

This plan introduces tabs on the three variant-heavy pages and restructures
"Bring your own model" around an explicit "two ways" framing.

## Current state

- `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` (125
  lines) — sections today: "How AskDB calls the model" (direct `ask({ model })`
  snippet), then H2 sections **OpenAI**, **Azure OpenAI**, **Anthropic**,
  **Any OpenAI-compatible endpoint**, then "Key management", "Switching
  models", "Cost", "Read next". Zero mentions of `@askdb/ai`, the config
  path, or Google (even though a first-party `@askdb/ai-google` adapter
  exists and the CLI registers it).
- `apps/docs-site/src/content/docs/guides/switch-engines.mdx` (123 lines) —
  has a matrix table (lines 27–32) and "Step by step" sections whose code
  blocks are single-engine examples with `# or @askdb/sqlite, ...` comments.
- `apps/docs-site/src/content/docs/install.mdx` (117 lines) — all install
  commands are `npm install ...` only; engine adapters listed as four
  commented lines in one block (lines 36–39); AI adapters as comment-toggled
  lines (lines 53–57).
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx` (129 lines) —
  single `npm install @askdb/core @ai-sdk/openai pg` block (line 13).
- Starlight version: `@astrojs/starlight` `^0.40.0`
  (`apps/docs-site/package.json`) — `Tabs`/`TabItem` with `syncKey` are
  available from `@astrojs/starlight/components`.
- **Verified facts about the model-wiring paths** (do not contradict these):
  - `ask()` accepts `model` typed as the Vercel AI SDK `LanguageModel`
    (`bring-your-own-model.mdx:12`, confirmed against `@askdb/core`).
  - First-party surfaces resolve the model from config like this
    (`apps/http-api/src/server.ts:9-14,34,300-302`):
    ```ts
    import { createAiRegistry } from "@askdb/ai";
    import { anthropicProvider } from "@askdb/ai-anthropic";
    import { azureProvider } from "@askdb/ai-azure";
    import { googleProvider } from "@askdb/ai-google";
    import { openaiProvider } from "@askdb/ai-openai";

    const ai = createAiRegistry([openaiProvider, azureProvider, googleProvider, anthropicProvider]);
    // later, with rt = getAskDbRuntimeConfig():
    const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
    ```
  - The registered first-party providers are `openai`, `azure`, `foundry`,
    `google`, `anthropic` (`reference/config.mdx:107`).
  - Config-side env keys per provider are documented in
    `reference/config.mdx:66-83` (e.g. `ANTHROPIC_API_KEY` →
    `ai.providerConfig.anthropic.apiKey`, default model `claude-sonnet-4-6`).
  - Engine matrix (`switch-engines.mdx:27-32`): `@askdb/postgres`/`"postgres"`/`pg`,
    `@askdb/mysql`/`"mysql"`/`mysql2`, `@askdb/sqlite`/`"sqlite"`/`better-sqlite3`,
    `@askdb/sqlserver`/`"sqlserver"`/`mssql`. All four dialect specs ship
    inside `@askdb/core`; engine packages are needed for introspection, not
    generation (`switch-engines.mdx:77`).
- Page conventions: `doc-eyebrow` + `doc-lede` opener, `home-path-grid`
  "Read next" footer. Match them; see any current guide page as exemplar.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Typecheck/lint the site | `pnpm --filter @askdb/docs-site lint` | exit 0 (`astro check`) |
| Build + link check | `pnpm --filter @askdb/docs-site test` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`
- `apps/docs-site/src/content/docs/guides/switch-engines.mdx`
- `apps/docs-site/src/content/docs/install.mdx`
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `quickstart.mdx` (plan 009 owns it), `astro.config.mjs` (plan 011),
  concept pages (plan 012), the homepage.
- `reference/config.mdx` — already accurate; link to it instead of
  duplicating its tables.
- Any `packages/*` source. If a code snippet seems wrong, that's a STOP, not
  a code fix.

## Git workflow

- Branch: `advisor/010-tabs-variant-examples`
- Commit per page; conventional style, e.g.
  `docs(site): tab per-provider model recipes and bridge the config path`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Use these sync keys consistently: `syncKey="ai-provider"` for model
providers, `syncKey="engine"` for database engines, `syncKey="pkg"` for
package managers. Import on each page that uses them:

```mdx
import { Tabs, TabItem } from "@astrojs/starlight/components";
```

### Step 1: Restructure "Bring your own model" around the two paths

Rewrite `guides/bring-your-own-model.mdx` to this structure (keep frontmatter,
eyebrow/lede style, and the existing "Key management", "Switching models",
"Cost", "Read next" sections — they survive mostly verbatim at the end):

1. **`## Two ways to wire a model`** — short prose + a two-row comparison:
   - *In your config* — set `ai.provider` in `askdb.config.ts`; the CLI,
     Studio, and the HTTP API resolve the model for you. No model code.
   - *In your code* — pass any Vercel AI SDK `LanguageModel` to `ask()`.
     Full control when embedding `@askdb/core`.
   State explicitly: same providers, same keys — pick per surface, and you
   can use both in one project.
2. **`## In your config (CLI, Studio, HTTP API)`** — one
   `<Tabs syncKey="ai-provider">` group with `TabItem`s **OpenAI**,
   **Anthropic**, **Google**, **Azure OpenAI** — each containing the
   matching `askdb.config.ts` `ai:` branch (shape from `reference/config.mdx`,
   e.g. for Anthropic `provider: "anthropic"`, `providerConfig.anthropic.apiKey: env("ANTHROPIC_API_KEY")`)
   and a one-line note of the default model where documented (OpenAI
   `gpt-4o-mini`, Anthropic `claude-sonnet-4-6`). Close the section linking
   to the Configuration reference for the env-var table and the custom-provider
   escape hatch.
3. **`## In your code (embedding)`** — keep the existing intro sentence about
   `LanguageModel` and the `ask()` snippet, then one
   `<Tabs syncKey="ai-provider">` group with the existing per-provider
   install+code recipes converted to `TabItem`s: **OpenAI**, **Anthropic**,
   **Google** (new — `npm install ai @ai-sdk/google`, `google("gemini-2.0-flash")`
   style; verify the exact import name `@ai-sdk/google` exposes, it is
   `google` from `"@ai-sdk/google"`), **Azure OpenAI**, **OpenAI-compatible**
   (the existing vLLM/Ollama/OpenRouter recipe).
4. **`## One config driving both`** — a short bridge section with the
   registry snippet so embedded code can reuse `askdb.config.ts` instead of
   hardcoding a provider:
   ```ts
   import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
   import { createAiRegistry } from "@askdb/ai";
   import { openaiProvider } from "@askdb/ai-openai";
   import { anthropicProvider } from "@askdb/ai-anthropic";

   bootstrapAskDbEnv({ cwd: process.cwd() });
   const rt = getAskDbRuntimeConfig();

   const ai = createAiRegistry([openaiProvider, anthropicProvider]);
   const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
   ```
   Note the install line: `npm install @askdb/config @askdb/ai @askdb/ai-openai @askdb/ai-anthropic`
   (adapters declare `ai` and `@askdb/ai` as peers — same caveat as
   `install.mdx:59`). Mention this is exactly how the first-party CLI and
   HTTP API resolve models internally.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 2: Tab the per-engine steps in "Switch engines"

In `guides/switch-engines.mdx`:

- Keep "What stays the same", "What changes", and "The matrix" table as-is.
- In "Step by step", convert steps 1, 2, and 4 to
  `<Tabs syncKey="engine">` groups with `TabItem`s **PostgreSQL**, **MySQL**,
  **SQLite**, **SQL Server**:
  - Step 1 (install): per-engine `npm install @askdb/<engine>` command.
  - Step 2 (introspect): per-engine `npx askdb introspect --engine <id> --url ...`
    with each engine's connection-string convention (SQLite uses a file path:
    `--engine sqlite` with the file flag documented in
    `reference/config.mdx:75` as `ASKDB_INTROSPECT_SQLITE_FILE` — if you
    cannot confirm the CLI flag for a SQLite file from
    `reference/cli.mdx`, show the config-file form for the SQLite tab
    instead of inventing a flag).
  - Step 4 (driver): per-engine driver snippet — the existing `mysql2`
    example for MySQL; write equivalents for `pg` (exists on the embed page,
    reuse its pool shape), `better-sqlite3`, and `mssql`, keeping each to
    ~6 lines.
- Step 3 (dialect value) stays prose + one snippet — the dialect string is a
  one-word change; tabs add nothing.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 3: Package-manager tabs on Install

In `install.mdx`, convert each `npm install` block to
`<Tabs syncKey="pkg">` with `TabItem`s **npm**, **pnpm**, **yarn** (same
packages, `npm install` / `pnpm add` / `yarn add`). Apply to: the CLI block
(line 21), the embedding block (lines 32–40), the model-provider block
(lines 49–57), the authoring block (lines 68–76), the introspection block
(lines 85–90), the RAG block (line 97), and the HTTP block (line 107).
Keep all surrounding prose and the comment lines inside blocks.

Also convert the engine-adapter portion of the embedding block to
`<Tabs syncKey="engine">` nested inside each package-manager tab **only if
nesting stays readable**; otherwise keep the four engine lines as comments in
a single block per package manager and note "pick one engine adapter" in
prose. Prefer the simpler outcome — do not nest two tab groups if the
rendered result is cluttered (build and look at the HTML output once:
`pnpm --filter @askdb/docs-site build` then inspect
`apps/docs-site/dist/install/index.html` for tab markup).

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 4: Package-manager tabs on "Embed in a Node app"

In `guides/embed-in-node.mdx`, convert the single install block (line 13) to
`<Tabs syncKey="pkg">` npm/pnpm/yarn. Nothing else on the page changes.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 5: Full site verification

**Verify**: `pnpm --filter @askdb/docs-site test` → exit 0.

## Test plan

Docs content has no unit tests. Gates: `astro check` (catches unclosed
`Tabs`/`TabItem` JSX and bad imports) and the base-path build + internal link
checker (`pnpm --filter @askdb/docs-site test`). Additionally, manually grep
that every page that uses `<Tabs` also imports it:
`grep -l "<Tabs" apps/docs-site/src/content/docs -r | xargs grep -L "@astrojs/starlight/components"`
→ empty output.

## Done criteria

- [ ] `pnpm --filter @askdb/docs-site lint` exits 0
- [ ] `pnpm --filter @askdb/docs-site test` exits 0
- [ ] `grep -c "syncKey=\"ai-provider\"" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` ≥ 2
- [ ] `grep -n "createLanguageModelFromEnv" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` → at least one match
- [ ] `grep -c "syncKey=\"engine\"" apps/docs-site/src/content/docs/guides/switch-engines.mdx` ≥ 3
- [ ] `grep -c "syncKey=\"pkg\"" apps/docs-site/src/content/docs/install.mdx` ≥ 5
- [ ] Google appears as a provider tab in both groups of bring-your-own-model
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `astro check` rejects `Tabs`/`TabItem` imports from
  `@astrojs/starlight/components` (Starlight version drift).
- You cannot verify the `@ai-sdk/google` import name or the
  `createAiRegistry`/`createLanguageModelFromEnv` API shape against
  `packages/ai/src/provider.ts` — never publish an unverified code recipe.
- The registry snippet in "Current state" no longer matches
  `apps/http-api/src/server.ts` (API drift since `bd751df`).
- Any in-scope page has been restructured since `bd751df` such that the
  line references in the steps no longer locate the right blocks.

## Maintenance notes

- When a new `@askdb/ai-<provider>` adapter ships (see
  `.claude/skills/new-ai-adapter/SKILL.md`, which already updates docs), it
  must be added to **both** tab groups on bring-your-own-model and the
  install-page provider block. Reviewers of future adapter PRs should check
  this page.
- The `syncKey` values (`ai-provider`, `engine`, `pkg`) are now site-wide
  contracts; plan 011's Studio page and any future page should reuse them
  verbatim.
- Deferred: tabs on `reference/config.mdx` provider examples — the reference
  page is organized as a single canonical example plus an env table, which
  reads fine linearly.
