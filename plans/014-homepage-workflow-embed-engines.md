# Plan 014: Homepage workflow, dual-path embed tabs, and parallel engine subtitles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/index.mdx apps/docs-site/src/components/HomeWorkflow.astro apps/docs-site/src/components/HomeEngines.astro`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

The landing page is the first thing a visitor reads, and three sections
currently misrepresent the product:

1. **"How it works"** collapses AskDB's real workflow (init → introspect →
   enrich → use) into three steps where "Author your schema" silently bundles
   introspect + enrich. A newcomer can't see that introspection and enrichment
   are distinct moves.
2. **"Embed it in your app"** shows only the Vercel AI SDK wiring
   (`@ai-sdk/openai`). AskDB also ships first-party `@askdb/ai-*` adapters that
   resolve the model from `askdb.config.ts` — the homepage should show both
   paths so visitors know the config-driven route exists.
3. **"Works with the database you already have"** gives each engine a
   non-parallel subtitle ("Full dialect coverage" vs "First-class dialect" vs
   "perfect for dev") that implies a support tiering AskDB doesn't actually
   have. Per `guides/switch-engines.mdx` ("All four engines … are first-class")
   and `concepts/modes-and-dialects.mdx`, **all four are first-class; Postgres
   is just the reference dialect where features land first.**

## Current state

- `apps/docs-site/src/content/docs/index.mdx` — the splash landing page. It
  imports home components and contains the "Embed it in your app" fenced code
  block. Relevant excerpt (lines 43–64):

  ```mdx
  ## Embed it in your app

  <p class="home-terminal-intro">A few lines of TypeScript: load a schema, ask a question, run the SQL through your own connection pool.</p>

  ```ts
  import { ask, loadSchema } from "@askdb/core";
  import { openai } from "@ai-sdk/openai";
  import { Pool } from "pg";

  const schema = await loadSchema("./my-app.schema");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { sql } = await ask({
    question: "Which customers signed up last week?",
    schema,
    dialect: "postgres",
    model: openai("gpt-4o-mini"),
  });

  // Log or approve `sql` here, then run it through your own pool.
  const result = await pool.query(sql);
  ```
  ```

  The file currently has **no** `import { Tabs, TabItem }` line (it imports only
  the `Home*` Astro components at lines 19–23).

- `apps/docs-site/src/components/HomeWorkflow.astro` — renders the "How it
  works" steps from a `steps` array in its frontmatter (lines 2–18). Current
  three steps: "Author your schema" (body mentions "Introspect your database,
  then enrich…"), "Ask in natural language", "Your app runs the SQL".

- `apps/docs-site/src/components/HomeEngines.astro` — renders engine cards from
  an `engines` array (lines 2–23). Current notes:
  - PostgreSQL: `"Reference engine. Full dialect coverage."`
  - MySQL: `"First-class dialect and introspection."`
  - SQLite: `"Embedded, file-backed, perfect for dev."`
  - SQL Server: `"T-SQL dialect and introspection."`

- **Conventions to match**:
  - Starlight Tabs are already used across the site with the
    `<Tabs syncKey="…"><TabItem label="…">` shape — see
    `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx:25`
    (`<Tabs syncKey="ai-provider">`) and its config-driven registry snippet at
    lines 217–228, which this plan's config-driven tab mirrors exactly.
  - In MDX, a fenced code block inside a `<TabItem>` **must be surrounded by
    blank lines** (blank line after the opening `<TabItem …>` and before the
    closing `</TabItem>`), exactly as in `install.mdx:22-47`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint (type/markup check) | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

(`pnpm lint` runs `astro check`; `pnpm test` runs a base-path build plus the
internal link checker. Both verified during recon.)

## Scope

**In scope** (the only files you may modify):
- `apps/docs-site/src/content/docs/index.mdx`
- `apps/docs-site/src/components/HomeWorkflow.astro`
- `apps/docs-site/src/components/HomeEngines.astro`

**Out of scope** (do NOT touch):
- Any other `.mdx` page (the engine wording elsewhere, e.g.
  `concepts/modes-and-dialects.mdx`, is already correct — leave it).
- CSS files (`.home-workflow`, `.home-engines` styling already lays out 3 and 4
  items respectively; do not add or change styles).
- The hero/frontmatter block of `index.mdx`.

## Git workflow

- Branch: `advisor/014-homepage-workflow-embed-engines`
- Commit message style matches `git log` (conventional, lowercase): e.g.
  `docs: lead homepage with the four-step workflow and dual-path embed`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Make "How it works" four steps (init → introspect → enrich → use)

In `apps/docs-site/src/components/HomeWorkflow.astro`, replace the three-item
`steps` array (lines 2–18) with four steps. Keep the existing object shape
(`number`, `title`, `body`) and the `01`/`02`/… zero-padded numbering. Target
content:

```js
const steps = [
  {
    number: "01",
    title: "Init",
    body: "Run askdb init to scaffold askdb.config.ts — your provider, database, and model settings, checked in like code.",
  },
  {
    number: "02",
    title: "Introspect",
    body: "AskDB reads your database (or a Prisma schema file) into a schema artifact: tables, columns, types, and relationships on disk.",
  },
  {
    number: "03",
    title: "Enrich",
    body: "In Studio, add the descriptions, aliases, business concepts, and sensitive markers that make generation reliable. Test questions as you go.",
  },
  {
    number: "04",
    title: "Use",
    body: "Call ask() from your app — or POST to the HTTP API. AskDB returns validated SQL; your application logs it, approves it, and runs it through your own pool.",
  },
];
```

Leave the `<ol class="home-workflow">` markup below the frontmatter unchanged —
it already maps over `steps`. Update its `aria-label` from
`"The three steps of using AskDB"` to `"The four steps of using AskDB"`.

**Verify**: `cd apps/docs-site && pnpm lint` → exit 0. Then
`grep -c "number:" apps/docs-site/src/components/HomeWorkflow.astro` → `4`.

### Step 2: Show both embed paths with synced Tabs on the homepage

In `apps/docs-site/src/content/docs/index.mdx`:

1. Add the Tabs import. After the existing component imports (the block ending
   at line 23 with `import HomePrivacyBoundary …`), add:

   ```mdx
   import { Tabs, TabItem } from "@astrojs/starlight/components";
   ```

2. Replace the single fenced `ts` code block under `## Embed it in your app`
   (the block currently at lines 47–64, starting `import { ask, loadSchema }`
   and ending `const result = await pool.query(sql);`) with a two-tab block.
   **Keep the `<p class="home-terminal-intro">…</p>` line above it unchanged.**
   Use `syncKey="wiring"` (a new site-wide key for the direct-vs-config-driven
   distinction). Mind the blank-line rule around fenced blocks inside TabItems:

   ```mdx
   <Tabs syncKey="wiring">
     <TabItem label="Direct (Vercel AI SDK)">

   ```ts
   import { ask, loadSchema } from "@askdb/core";
   import { openai } from "@ai-sdk/openai";
   import { Pool } from "pg";

   const schema = await loadSchema("./my-app.schema");
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });

   const { sql } = await ask({
     question: "Which customers signed up last week?",
     schema,
     dialect: "postgres",
     model: openai("gpt-4o-mini"),
   });

   // Log or approve `sql` here, then run it through your own pool.
   const result = await pool.query(sql);
   ```

     </TabItem>
     <TabItem label="Config-driven (@askdb/ai)">

   ```ts
   import { ask, loadSchema } from "@askdb/core";
   import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
   import { createAiRegistry } from "@askdb/ai";
   import { openaiProvider } from "@askdb/ai-openai";
   import { Pool } from "pg";

   // Resolve the model from askdb.config.ts — same config the CLI and Studio use.
   bootstrapAskDbEnv({ cwd: process.cwd() });
   const rt = getAskDbRuntimeConfig();
   const ai = createAiRegistry([openaiProvider]);
   const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);

   const schema = await loadSchema("./my-app.schema");
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });

   const { sql } = await ask({
     question: "Which customers signed up last week?",
     schema,
     dialect: "postgres",
     model,
   });

   // Log or approve `sql` here, then run it through your own pool.
   const result = await pool.query(sql);
   ```

     </TabItem>
   </Tabs>
   ```

   Note: the indentation of the fenced ` ```ts ` blocks above is shown indented
   for readability, but in MDX the code fences should start at column 0 (not
   indented) so they parse as code blocks — match the exact pattern in
   `install.mdx:22-47`, where the ` ``` ` fences are flush-left and only the
   `<TabItem>` tags are indented.

The config-driven snippet is copied from the verified pattern in
`bring-your-own-model.mdx:217-228`; do not invent different symbol names.

**Verify**: `cd apps/docs-site && pnpm lint` → exit 0. Then
`grep -c 'syncKey="wiring"' apps/docs-site/src/content/docs/index.mdx` → `1`.

### Step 3: Make engine subtitles parallel and accurate

In `apps/docs-site/src/components/HomeEngines.astro`, update only the `note`
strings in the `engines` array (lines 2–23) so all four read as parallel,
first-class descriptions. Leave `name` and `pkg` unchanged. Target:

```js
const engines = [
  {
    name: "PostgreSQL",
    pkg: "@askdb/postgres",
    note: "Reference dialect — new features land here first.",
  },
  {
    name: "MySQL",
    pkg: "@askdb/mysql",
    note: "First-class dialect and introspection.",
  },
  {
    name: "SQLite",
    pkg: "@askdb/sqlite",
    note: "First-class dialect — embedded and file-backed, great for dev and tests.",
  },
  {
    name: "SQL Server",
    pkg: "@askdb/sqlserver",
    note: "First-class T-SQL dialect and introspection.",
  },
];
```

This matches `guides/switch-engines.mdx` ("All four engines … are first-class")
and `concepts/modes-and-dialects.mdx:22-25`. Do not add a caption or change the
surrounding markup.

**Verify**: `cd apps/docs-site && pnpm lint` → exit 0. Then
`grep -c "First-class" apps/docs-site/src/components/HomeEngines.astro` → `3`.

## Test plan

This is a docs/markup change; there are no unit tests. Verification is the
Astro build + link check:

- `cd apps/docs-site && pnpm test` → exit 0 (base-path build succeeds and the
  internal link checker reports no broken links). This confirms the new Tabs
  block parses and the page still renders.

## Done criteria

ALL must hold:

- [ ] `cd apps/docs-site && pnpm lint` exits 0 with `0 errors`
- [ ] `cd apps/docs-site && pnpm test` exits 0
- [ ] `HomeWorkflow.astro` has exactly 4 step objects (`grep -c "number:" …` → `4`) and titles read Init / Introspect / Enrich / Use
- [ ] `index.mdx` contains one `<Tabs syncKey="wiring">` with a "Direct (Vercel AI SDK)" tab and a "Config-driven (@askdb/ai)" tab
- [ ] `HomeEngines.astro` notes are parallel; `grep -c "First-class" …` → `3`
- [ ] Only the three in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since
  `4w80530` — re-check before editing).
- `.home-workflow` CSS turns out to hard-code exactly three columns such that a
  fourth step renders broken (inspect the rendered page after Step 1; if the
  layout breaks, report rather than restyling — CSS is out of scope).
- `astro check` reports an MDX parse error on the new Tabs block that you can't
  resolve by matching `install.mdx`'s exact fence/blank-line pattern within two
  attempts.

## Maintenance notes

- The `wiring` syncKey is introduced here. If any other page later shows the
  same direct-vs-config-driven choice, reuse `syncKey="wiring"` verbatim so the
  tabs stay in sync site-wide. Record it alongside the existing keys
  (`ai-provider`, `engine`, `pkg`) noted in `plans/README.md`.
- A reviewer should confirm the config-driven snippet still matches
  `bring-your-own-model.mdx` (single source of truth for that pattern) — if the
  registry API changes, update both.
- The homepage embed snippet keeps `loadSchema("./my-app.schema")`; the
  clarification that this is the artifact **directory** (not a file) is handled
  for the embed guide in plan 017. If 017 changes the canonical path example,
  reconcile the homepage snippet to match.
