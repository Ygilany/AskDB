# Plan 027: Document the `@askdb/client` facade across the docs site and internal docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d7faa20..HEAD -- apps/docs-site/src/content/docs/index.mdx apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx apps/docs-site/src/content/docs/guides/embed-in-node.mdx apps/docs-site/src/content/docs/reference/packages.mdx docs/architecture.md docs/specs/core-pipeline.md`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **API-exists check (run first)**: `ls packages/client/src/client.ts && grep -n "export {" packages/client/src/index.ts`
> The package and its exports (`createAskDb`, `AskDbClient`, `CreateAskDbOptions`,
> `AskOverrides`, `SchemaSource`, `DialectResolution`) must exist — this plan
> documents the API built in plan 024. If they do not exist or differ, STOP.

## Status

- **Priority**: P2
- **Effort**: M (many files, but mechanical prose/snippet edits)
- **Risk**: LOW (docs only; no code, no API changes)
- **Depends on**: plans/024-askdb-client-facade.md (hard — the API must exist and match). **Land after 025 and 026** when possible so the docs describe what the shipped hosts/example actually do (not a hard blocker — the facade API is stable from 024).
- **Category**: docs
- **Planned at**: commit `d7faa20`, 2026-06-15

## Why this matters

Plans 024–026 add `@askdb/client` (`createAskDb`) — the config-aware facade that
lets callers pass only a question, with `schema`/`model`/`dialect` as optional
overrides. Every doc that teaches how to call AskDB today shows the hand-wired
`loadSchema()` + `createLanguageModelFromEnv()` + `ask({ question, schema, model,
dialect })` path. Until the docs lead with the facade, the ergonomic win is
invisible to users and the docs contradict the recommended path. This plan
updates the user-facing docs site and the internal architecture/spec docs to
present `createAskDb` as the fast path while keeping the direct `@askdb/core`
`ask()` path documented as the BYO / full-control escape hatch (which `@askdb/core`
guarantees and which plan 024 explicitly preserved).

## Current state

The new API (from `@askdb/client`, plan 024) the docs must describe:

```ts
import { createAskDb } from "@askdb/client";
const askdb = createAskDb({
  config,      // AskDbRuntimeConfig, e.g. getAskDbRuntimeConfig()
  registry,    // AiRegistry, e.g. createAiRegistry([openaiProvider])
  schema,      // optional default: { path } | { json } | { schema } — falls back to config host.schemaPath/schemaJson
  dialect,     // optional default BuiltInDialectId — falls back to config.dialect → schema.provider → "postgres"
});
const { sql } = await askdb.ask("question", {
  /* optional per-call overrides: schema, model, dialect, plus all ask() options */
});
```

Key facts to keep accurate in the prose:
- `createAskDb` needs **both** a `config` and a `registry`; the registry is built
  by the host from `@askdb/ai` adapters (`createAiRegistry([...])`). The facade
  does **not** bundle providers.
- `model` resolves from the registry by default; pass `overrides.model` to
  override with any AI SDK `LanguageModel` (raw `@ai-sdk/*` or `@askdb/ai`-built).
- `ask()` in `@askdb/core` is unchanged and stays the pure, required-args
  primitive — the facade calls it.

### The docs files this plan edits (read each before editing)

1. **`apps/docs-site/src/content/docs/reference/packages.mdx`** — the package
   index. The "Core" section lists `@askdb/core` then `@askdb/ai` with a
   "Key exports" table each. There is no `@askdb/client` entry yet. Excerpt
   (the `@askdb/ai` lede, which the new entry sits before):

   ```mdx
   ### `@askdb/ai`

   Optional AI provider registry and shared config helpers. Install this when you want AskDB to
   construct AI SDK language or embedding models from `askdb.config.*` / env maps...
   ```

2. **`apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`** — the
   canonical wiring page. It has three sections: "In your config", "In your code
   (embedding)", and "One config driving both". The last section currently shows
   the registry + `ask()` path:

   ```mdx
   ## One config driving both

   If you embed `@askdb/core` but want to reuse the same `askdb.config.ts` instead of hardcoding a provider, use the AI registry. This is exactly how the CLI and the bundled HTTP API resolve models internally.

   ```bash
   npm install @askdb/config @askdb/ai @askdb/ai-openai @askdb/ai-anthropic
   ```

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
   ```

   The "Two ways to wire a model" table at the top (lines ~13–18) will become
   three ways.

3. **`apps/docs-site/src/content/docs/guides/embed-in-node.mdx`** — the full
   Node walkthrough. Installs `@askdb/core @ai-sdk/openai pg`, loads the schema,
   and wires `ask({ question, schema, dialect, model })` directly (the "Wire
   `ask()` into a handler" section).

4. **`apps/docs-site/src/content/docs/index.mdx`** — the homepage "Embed it in
   your app" section uses `<Tabs syncKey="wiring">` with two tabs labelled
   **"Direct (Vercel AI SDK)"** and **"Config-driven (@askdb/ai)"** (lines
   ~48–104). The config-driven tab builds a registry then calls `ask({...})`.

5. **`docs/architecture.md`** — the "Package map" table (lines ~109–129) lists
   each `@askdb/*` package + "Out of scope" notes; the "Dependency boundaries"
   section (lines ~197–204) states `@askdb/core` never depends on `@askdb/ai`.
   No `@askdb/client` row exists.

6. **`docs/specs/core-pipeline.md`** — the core pipeline spec. Line 12 notes the
   CLI wraps `ask()`; no mention of `@askdb/client`.

### Conventions to match

- **Starlight MDX**: tabs are `<Tabs syncKey="...">` / `<TabItem label="...">`;
  callouts are `<Aside type="note">...</Aside>`. Code fences use ` ```ts ` /
  ` ```bash `. Page intros use `<p class="doc-eyebrow">` and `<p class="doc-lede">`.
- **`syncKey` is a site-wide contract** (established by plans 010/014). The
  homepage `wiring` tab **labels must stay exactly** `"Direct (Vercel AI SDK)"`
  and `"Config-driven (@askdb/ai)"` so tab selection stays synced across pages —
  change the snippet inside the config-driven tab, NOT its label.
- **Internal docs** (`docs/*.md`) are plain GitHub-flavored Markdown with Mermaid
  fences; match the surrounding table/bullet style.
- Model ids in examples follow what the page already uses (e.g. `gpt-4o-mini`) —
  do not invent new ones.

## Commands you will need

| Purpose                  | Command                                  | Expected             |
|--------------------------|------------------------------------------|----------------------|
| Docs-site typecheck/lint | `pnpm --filter @askdb/docs-site lint`    | exit 0 (astro check) |
| Docs-site build + links  | `pnpm --filter @askdb/docs-site test`    | build OK, links OK   |
| Find leftover patterns   | `grep -rn "createAskDb" apps/docs-site/src/content` | matches in edited pages |

(`apps/docs-site` scripts: `lint` = `astro check`, `test` = build with
`ASTRO_BASE=/AskDB` then `test:links`. These are the gates. Internal `docs/*.md`
have no build step — verify by reading the diff.)

## Scope

**In scope** (edit these):
- `apps/docs-site/src/content/docs/reference/packages.mdx`
- `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
- `apps/docs-site/src/content/docs/index.mdx`
- `docs/architecture.md`
- `docs/specs/core-pipeline.md`
- `.changeset/document-askdb-client.md` (create — docs-site is versioned)

**Out of scope** (do NOT touch):
- Any `packages/**` or `apps/cli` / `apps/http-api` source — code is plans 024/025.
- Other docs-site pages (`quickstart.mdx`, `deploy-as-http-service.mdx`,
  `multi-tenancy.mdx`, `rag-for-large-schemas.mdx`, etc.) — leaving the direct
  `ask()` path in those is fine and keeps this PR reviewable. If one clearly
  contradicts the facade after these edits, note it in "Maintenance notes" rather
  than expanding scope.
- The package-dependency SVG diagram (`assets/diagrams/askdb-package-dependencies.svg`)
  — regenerating it is a separate task; the caption text is enough here.
- Do NOT remove or rewrite the direct `ask()` examples — the BYO path must remain
  documented. Only **add** the facade as the lead/fast path.

## Git workflow

- Branch: `advisor/027-document-askdb-client`
- Commit per file or per logical group (docs-site, then internal docs).
- Conventional commits, e.g. `docs(site): document the @askdb/client fast path`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `@askdb/client` to the package reference

In `reference/packages.mdx`, add a new entry in the **Core** section,
immediately **before** `### \`@askdb/ai\``:

```mdx
### `@askdb/client`

Config-aware facade over `@askdb/core`. `createAskDb()` resolves the schema, model, and
dialect from your `askdb.config.*` (and a provider registry you supply), so call sites pass
only a question. Install it when you want the shortest config-driven path; skip it when you
construct the model and load the schema yourself and call `ask()` directly.

```bash
npm install @askdb/client @askdb/ai @askdb/ai-openai @askdb/config
```

**Key exports**

| Symbol | Purpose |
| --- | --- |
| `createAskDb(options)` | Build a client bound to a config + AI registry. Returns `{ ask, reload }`. |
| `client.ask(question, overrides?)` | Resolve schema/model/dialect and run the pipeline. Overrides: `schema`, `model`, `dialect`, plus all `ask()` options. |
| `AskDbClient` / `CreateAskDbOptions` / `AskOverrides` | Types for the client, constructor options, and per-call overrides. |
```

Also update the diagram caption note (the `<p class="doc-caption">` under the
image) to mention the facade, e.g. append a sentence: "`@askdb/client` sits above
`@askdb/core` + `@askdb/ai` as the config-driven entry point."

**Verify**: `grep -n "@askdb/client" apps/docs-site/src/content/docs/reference/packages.mdx`
→ matches in the new section and the caption.

### Step 2: Add the facade path to "Bring your own model"

In `guides/bring-your-own-model.mdx`:

1. Change the "Two ways to wire a model" table into **three** ways by adding a row
   for the facade (keep the existing two rows):

   ```mdx
   | **With `@askdb/client`** | Call `createAskDb({ config, registry })` then `askdb.ask("question")`. Schema, model, and dialect come from config. | The shortest config-driven embed — one schema, one model |
   ```

2. Replace the body of the **"One config driving both"** section so the facade
   is the lead, and the raw registry is shown as the lower-level alternative:

   ```mdx
   ## One config driving both

   If you embed AskDB but want to reuse the same `askdb.config.ts` instead of hardcoding a provider, use `@askdb/client`. `createAskDb` resolves the schema, model, and dialect from your config and a provider registry — the same resolution the CLI and the bundled HTTP API use.

   ```bash
   npm install @askdb/client @askdb/config @askdb/ai @askdb/ai-openai @askdb/ai-anthropic
   ```

   ```ts
   import { createAskDb } from "@askdb/client";
   import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
   import { createAiRegistry } from "@askdb/ai";
   import { openaiProvider } from "@askdb/ai-openai";
   import { anthropicProvider } from "@askdb/ai-anthropic";

   bootstrapAskDbEnv({ cwd: process.cwd() });

   const askdb = createAskDb({
     config: getAskDbRuntimeConfig(),
     registry: createAiRegistry([openaiProvider, anthropicProvider]),
     schema: { path: "./my-app.schema" }, // or set host.schemaPath in config and omit this
   });

   // Only the question — schema, model, and dialect come from config.
   const { sql } = await askdb.ask("Which customers signed up last week?");
   ```

   Need the model object yourself (to pass to `ask()` directly, or to share with other code)? Build it from the same config with the registry:

   ```ts
   import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
   import { createAiRegistry } from "@askdb/ai";
   import { openaiProvider } from "@askdb/ai-openai";

   bootstrapAskDbEnv({ cwd: process.cwd() });
   const rt = getAskDbRuntimeConfig();
   const ai = createAiRegistry([openaiProvider]);
   const model = await ai.createLanguageModelFromEnv(rt.ai.aiEnv);
   ```

   Adapters declare `ai` and `@askdb/ai` as peer dependencies — add `ai` to your own `package.json` when you want to pin its version.
   ```

3. Leave "In your config" and "In your code (embedding)" sections unchanged — the
   direct `ask({ question, schema, dialect, model })` example stays.

**Verify**: `grep -c "createAskDb" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`
→ ≥1; the direct `ask({` example is still present (`grep -n "await ask({" ...` → match).

### Step 3: Add the fast path to "Embed in a Node app"

In `guides/embed-in-node.mdx`, add a new section **after** "Wire `ask()` into a
handler" (so the direct path is taught first, then the shortcut) titled
"Shorter: let config resolve schema + model". Keep it brief and link back:

```mdx
## Shorter: let config resolve schema + model

If you already use `askdb.config.ts`, `@askdb/client` removes the manual schema load and model construction. `createAskDb` resolves both from config; you pass only the question.

```bash
npm install @askdb/client @askdb/ai @askdb/ai-openai @askdb/config pg
```

```ts
// ask-handler.ts
import { createAskDb } from "@askdb/client";
import { getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { Pool } from "pg";

const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),                 // after bootstrapAskDbEnv() at startup
  registry: createAiRegistry([openaiProvider]),
  schema: { path: "./my-app.schema" },             // or set host.schemaPath in config and omit
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function askQuestion(question: string) {
  const { sql } = await askdb.ask(question);
  const { rows } = await pool.query(sql);
  return { sql, rows };
}
```

<Aside type="note">
The direct `ask()` path above is still the right choice when you construct the model yourself, serve multiple schemas from one process, or want zero dependency on `@askdb/config` / `@askdb/ai`. `createAskDb` is a convenience layer over the same `ask()` — not a replacement.
</Aside>
```

Make sure `Aside` is already imported at the top of the file (it is —
`import { Tabs, TabItem, Aside } from "@astrojs/starlight/components";`).

**Verify**: `grep -n "createAskDb" apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
→ match; the original "Wire `ask()` into a handler" section is unchanged
(`grep -n "Wire \`ask()\` into a handler" ...` → match).

### Step 4: Simplify the homepage "Config-driven" tab

In `index.mdx`, inside `<Tabs syncKey="wiring">`, replace the **contents** of the
`<TabItem label="Config-driven (@askdb/ai)">` code block with the facade version.
**Do not change the `label`** (the syncKey contract depends on it):

```ts
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { Pool } from "pg";

// Resolve schema, model, and dialect from askdb.config.ts — same config the CLI and Studio use.
bootstrapAskDbEnv({ cwd: process.cwd() });
const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  registry: createAiRegistry([openaiProvider]),
  schema: { path: "./my-app.schema" }, // or set host.schemaPath in config and omit
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { sql } = await askdb.ask("Which customers signed up last week?");

// Log or approve `sql` here, then run it through your own pool.
const result = await pool.query(sql);
```

Leave the "Direct (Vercel AI SDK)" tab unchanged.

**Verify**: `grep -n "Config-driven (@askdb/ai)" apps/docs-site/src/content/docs/index.mdx`
→ label still present; `grep -n "createAskDb" apps/docs-site/src/content/docs/index.mdx`
→ match.

### Step 5: Build the docs site

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0, then
`pnpm --filter @askdb/docs-site test` → build succeeds and link check passes.
If `astro check` flags an MDX/JSX error, fix the snippet formatting (usually an
unbalanced fence or an unimported component) and re-run.

### Step 6: Update the internal architecture + spec docs

In `docs/architecture.md`:
1. Add a row to the "Package map" table near `@askdb/core` (line ~120). Match the
   table's column shape (`| Package | ... | Out of scope |`):
   ```md
   | `@askdb/client` | Config-aware facade over `@askdb/core`: `createAskDb()` resolves schema, model, and dialect from config + a provider registry so callers pass only a question. | No provider SDKs bundled; the registry is host-supplied. `@askdb/core` never depends on it. |
   ```
2. In "Dependency boundaries" (after the `@askdb/ai` bullet, ~line 203), add:
   ```md
   - `@askdb/client` is a convenience layer **above** `@askdb/core`: it depends on `@askdb/core`, `@askdb/ai`, and `@askdb/config` to resolve a schema/model/dialect, then calls `ask()`. The dependency arrow points one way — `@askdb/core` does not know `@askdb/client` exists, preserving the BYO-model boundary.
   ```

In `docs/specs/core-pipeline.md`, after line 12 (the CLI-wraps-`ask()`
paragraph), add:
```md
The `@askdb/client` package provides `createAskDb()`, a config-aware facade that resolves the schema, model, and dialect from `askdb.config.*` (plus a host-supplied AI registry) and then calls `ask()`. It is strictly a consumer of this pipeline — `ask()` keeps its required, fully-explicit arguments and remains the pure BYO-model primitive; the facade adds no behavior to the core contract.
```

**Verify**: `grep -n "@askdb/client" docs/architecture.md docs/specs/core-pipeline.md`
→ matches in all three locations.

### Step 7: Changeset

Create `.changeset/document-askdb-client.md`:

```md
---
"@askdb/docs-site": patch
---

Document the `@askdb/client` facade: add it to the package reference, lead the "bring your own model", embed-in-Node, and homepage embed examples with the `createAskDb` fast path, and keep the direct `ask()` BYO path documented.
```

(Confirm the docs-site package name with
`node -p "require('./apps/docs-site/package.json').name"` — it is
`@askdb/docs-site`. If changesets ignore the docs site, skip this file and note
it; check `.changeset/config.json` `ignore` list.)

**Verify**: `pnpm --filter @askdb/docs-site test` → still passes.

## Test plan

- No unit tests (docs only). Verification is the docs-site build + link check
  (`astro check` and `test:links`) passing, and grep checks confirming each page
  gained the facade content while retaining the direct `ask()` examples.
- Manually skim the rendered intent: the homepage and BYO guide should show
  `createAskDb` as a first-class path; embed-in-Node should keep the direct path
  first with the facade as a shortcut.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/docs-site lint` exits 0
- [ ] `pnpm --filter @askdb/docs-site test` exits 0 (build + links)
- [ ] `grep -rln "createAskDb" apps/docs-site/src/content` lists `reference/packages.mdx`, `guides/bring-your-own-model.mdx`, `guides/embed-in-node.mdx`, and `index.mdx`
- [ ] Direct `ask()` examples still present: `grep -rn "await ask({" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx apps/docs-site/src/content/docs/index.mdx` returns matches
- [ ] `grep -n "@askdb/client" docs/architecture.md docs/specs/core-pipeline.md` returns matches in both
- [ ] Homepage `wiring` tab labels unchanged: `grep -n "Direct (Vercel AI SDK)\|Config-driven (@askdb/ai)" apps/docs-site/src/content/docs/index.mdx` returns both
- [ ] `git status` shows changes only within the in-scope list
- [ ] `plans/README.md` status row for 027 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `@askdb/client` exports differ from plan 024's API (`createAskDb`,
  `client.ask(question, overrides)`, the option/override names) — the snippets
  would teach a wrong API. Verify against `packages/client/src/index.ts` first.
- `astro check` fails on something outside the edited snippets (pre-existing
  breakage) — report rather than fixing unrelated pages.
- The "Current state" excerpts don't match the live pages (docs drifted since
  `d7faa20`).
- A docs-site build/link check fails twice after a reasonable fix attempt.

## Maintenance notes

- The homepage `wiring` tab labels are a synced contract across pages — if a
  future page adds the same Direct/Config-driven choice, reuse the exact labels;
  if the labels ever change, change them everywhere in one pass.
- Pages intentionally left on the direct `ask()` path (`quickstart.mdx`,
  `deploy-as-http-service.mdx`, `rag-for-large-schemas.mdx`,
  `multi-tenancy.mdx`) are fine — but if the maintainer later wants the facade as
  the site-wide default, those are the follow-up surfaces. The RAG guide is a
  good candidate (`createAskDb(...).ask(q, { retriever, totalSchemaChunkCount })`).
- Keep the "facade is a convenience, not a replacement" framing — `@askdb/core`'s
  `ask()` is the guaranteed primitive; docs should never imply it's deprecated.
- Reviewer should confirm: no direct-`ask()` example was deleted; the `@askdb/client`
  install lines list the registry adapter packages (the facade can't resolve a
  model without them).
