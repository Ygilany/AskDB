# Plan 015: Quickstart — ask-first loop diagram, Prisma-as-tab, and Studio→embed framing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/quickstart.mdx apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (no file overlap with plan 014)
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

Three quickstart problems blunt the "first five minutes" experience:

1. **The loop diagram reads enrich-then-ask and wastes a third of its width.**
   The SVG orders boxes init → introspect → **enrich → ask**, implying you must
   fully enrich before you can ask. The intended message is the opposite: ask
   early on the raw introspection, then enrich to *improve* the result. The
   `viewBox` is also `0 0 920 160` while the content ends at x≈757, leaving ~160
   units of dead space on the right.
2. **Prisma introspection gets its own H3 section** ("From a Prisma schema")
   parallel to "From a live database," when these are two variants of the same
   step — better expressed as synced Tabs (the pattern the rest of the site
   uses for variants).
3. **The "ask in Studio (recommended)" guidance doesn't say *why* Studio is the
   recommended place to ask**: it's where you iterate on enrichment until the
   SQL satisfies your users — and once you're happy, you embed the same schema
   into your own tools. The quickstart never connects "ask in Studio" to "then
   embed it."

## Current state

- `apps/docs-site/src/content/docs/quickstart.mdx` — the quickstart page.
  - Imports at top (lines 6–7):
    ```mdx
    import { Aside } from "@astrojs/starlight/components";
    import quickstartLoopUrl from "../../assets/diagrams/askdb-quickstart-loop.svg?url";
    ```
    (Note: `Tabs`/`TabItem` are **not** imported yet — Step 2 adds them.)
  - The `<img>` for the loop diagram is at line 33.
  - The Prisma section is `### From a Prisma schema` at lines 108–125, directly
    after `### From a live database` (lines 81–106), both under `## 2. Introspect
    your database`. Current Prisma section body:
    ```mdx
    ### From a Prisma schema

    If you already have a Prisma schema file, introspect directly from it — no live database required:

    ```bash
    npx askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma
    ```

    You can also set this in `askdb.config.ts` so no flags are needed:

    ```ts
    introspection: {
      provider: "prisma",
      providerConfig: {
        prisma: { schemaPath: "./prisma/schema.prisma" },
      },
    },
    ```
    ```
  - The "ask in Studio (recommended)" block is `### In Studio (recommended)` at
    lines 151–153:
    ```mdx
    ### In Studio (recommended)

    If Studio is already open from step 3, ask your question there. You'll see the generated SQL alongside the schema; if the answer isn't right, keep enriching descriptions, aliases, or concepts and re-ask in the same session.
    ```

- `apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg` — the loop
  diagram, full current contents:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 160" role="img" aria-labelledby="qltitle qldesc">
    <title id="qltitle">AskDB quickstart loop</title>
    <desc id="qldesc">Four-step loop: init creates config, introspect reads the database into a schema artifact, enrich in Studio adds descriptions and tests questions, ask generates validated SQL — with a loop-back from ask to enrich to refine until the SQL is right.</desc>
    ...four <rect>/<text> step blocks at x=8, 205, 402, 599...
    <!-- Step 3: enrich (Studio) at x=402, red -->
    <!-- Step 4: ask at x=599, green -->
    <!-- Loop-back arrow ask→enrich path M678,110 ... -->
  </svg>
  ```
  Boxes are 158 wide, 72 tall, at y=38; gap is 39 (e.g. arrow `x1=166 x2=205`).
  Step 3 (enrich) is styled red (`fill="#fef2f2" stroke="#a10b2c"`), Step 4
  (ask) green (`fill="#ecfdf5" stroke="#047857"`). The loop arrow runs from the
  4th box back to the 3rd.

- **Conventions to match**:
  - Synced Tabs: `<Tabs syncKey="…">` with fenced blocks blank-line-padded
    inside each `<TabItem>` — see `install.mdx:22-47`. The site's established
    syncKey for engine choice is `engine` (per `plans/README.md`); use it here.
  - `<Aside type="tip">` / `<Aside type="note">` are already used in this file
    (line 43) for callouts.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg`

**Out of scope** (do NOT touch):
- The other SVGs in `assets/diagrams/` (hero, package-deps, runtime-boundary).
- The four-command code block at quickstart lines 22–27 — leave the command
  order as-is (init / introspect / studio / ask). Only the *diagram* below it
  changes.
- `concepts/how-askdb-works.mdx` and any other page.

## Git workflow

- Branch: `advisor/015-quickstart-loop-prisma-tabs`
- Commit style: conventional, e.g. `docs(quickstart): ask-first loop diagram and Prisma tab`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite the loop SVG — ask before enrich, trimmed viewBox

Replace the **entire contents** of
`apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg` with the
following. Changes from the original: box order is now init → introspect →
**ask → enrich** (ask is green box 3, enrich is red box 4); the loop-back arrow
runs enrich → ask ("refine until the SQL is right"); `viewBox` width is trimmed
from 920 to 765 to remove the dead space; `<title>`/`<desc>` updated.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 765 160" role="img" aria-labelledby="qltitle qldesc">
  <title id="qltitle">AskDB quickstart loop</title>
  <desc id="qldesc">Four steps: init creates config, introspect reads the database into a schema artifact, ask generates validated SQL from your first question, and enrich in Studio adds descriptions and tests questions — with a loop-back from enrich to ask to refine until the SQL is right.</desc>
  <defs>
    <marker id="qarrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#475569"/>
    </marker>
    <marker id="qarrow-loop" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#a10b2c"/>
    </marker>
  </defs>
  <!-- Step 1: init -->
  <rect x="8" y="38" width="158" height="72" rx="8" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
  <text x="87" y="66" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#0f172a">init</text>
  <text x="87" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">scaffold</text>
  <text x="87" y="100" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">askdb.config.ts</text>
  <!-- Arrow 1→2 -->
  <line x1="166" y1="74" x2="205" y2="74" stroke="#475569" stroke-width="2" marker-end="url(#qarrow)"/>
  <!-- Step 2: introspect -->
  <rect x="205" y="38" width="158" height="72" rx="8" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
  <text x="284" y="66" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#0f172a">introspect</text>
  <text x="284" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">read database into</text>
  <text x="284" y="100" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">schema artifact</text>
  <!-- Arrow 2→3 -->
  <line x1="363" y1="74" x2="402" y2="74" stroke="#475569" stroke-width="2" marker-end="url(#qarrow)"/>
  <!-- Step 3: ask -->
  <rect x="402" y="38" width="158" height="72" rx="8" fill="#ecfdf5" stroke="#047857" stroke-width="2"/>
  <text x="481" y="66" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#064e3b">ask</text>
  <text x="481" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#064e3b">validated SQL from</text>
  <text x="481" y="100" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#064e3b">your first question</text>
  <!-- Arrow 3→4 -->
  <line x1="560" y1="74" x2="599" y2="74" stroke="#475569" stroke-width="2" marker-end="url(#qarrow)"/>
  <!-- Step 4: enrich (Studio) -->
  <rect x="599" y="38" width="158" height="72" rx="8" fill="#fef2f2" stroke="#a10b2c" stroke-width="2"/>
  <text x="678" y="66" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#5b0719">enrich (Studio)</text>
  <text x="678" y="84" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">add descriptions,</text>
  <text x="678" y="100" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#64748b">improve the answer</text>
  <!-- Loop-back arrow: enrich → ask, drawn below the boxes -->
  <path d="M678,110 L678,132 L481,132 L481,110" fill="none" stroke="#a10b2c" stroke-width="2" stroke-dasharray="5,3" marker-end="url(#qarrow-loop)"/>
  <text x="580" y="148" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#a10b2c">refine until the SQL is right</text>
</svg>
```

Then update the `alt` text of the `<img>` at `quickstart.mdx:33` so it matches
the new flow. Replace its `alt="…"` value with:

```
Four steps: init scaffolds config, introspect reads the database into a schema artifact, ask generates validated SQL from your first question, enrich in Studio adds descriptions — with a loop-back from enrich to ask to refine until the SQL is right
```

**Verify**: `grep -c 'viewBox="0 0 765 160"' apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg` → `1`. Then `cd apps/docs-site && pnpm lint` → exit 0.

### Step 2: Convert the Prisma introspection variant to a Tab

In `quickstart.mdx`:

1. Add the Tabs import next to the existing imports (after line 7):
   ```mdx
   import { Tabs, TabItem } from "@astrojs/starlight/components";
   ```

2. Replace the two H3 subsections under `## 2. Introspect your database` —
   `### From a live database` (lines 81–106) **and** `### From a Prisma schema`
   (lines 108–125) — with a single `<Tabs syncKey="engine">` block containing a
   "Live database" tab (carrying the existing live-database prose and the two
   code blocks at lines 85–98 and 102–104) and a "Prisma schema file" tab
   (carrying the existing Prisma prose and its two code blocks). Do **not** drop
   any of the existing explanatory prose — move it into the matching tab.
   Preserve the paragraph that currently sits at lines 100–106 ("The database is
   only used here…", "The engine comes from `introspection.provider`…") — keep
   it **inside the "Live database" tab** after the `--url` example, since it's
   about the live-DB path.

   Target shape (fences flush-left; only `<TabItem>` indented — match
   `install.mdx`):

   ```mdx
   ## 2. Introspect your database

   Introspection produces an **AskDB schema artifact** — a directory on disk that captures your tables, columns, types, and relationships. Those artifacts' content are the only thing the model ever sees about your database.

   <Tabs syncKey="engine">
     <TabItem label="Live database">

   With your database connection configured in `askdb.config.ts` under `introspection.provider` and `introspection.providerConfig`, one command is enough:

   ```bash
   npx askdb introspect
   ```

   For example, for Postgres:

   ```ts
   introspection: {
     provider: "postgres",
     providerConfig: {
       postgres: { databaseUrl: env("DATABASE_URL") },  // env name is yours to pick
     },
   },
   ```

   The database is only used here — for introspection. To target a different database for one run, pass `--url`:

   ```bash
   npx askdb introspect --url "$OTHER_DATABASE_URL"
   ```

   The engine comes from `introspection.provider` in your config (or the `--engine` flag); the introspected artifact records it, and `askdb ask` later infers the SQL dialect from the artifact. The complete config surface is documented in the [Configuration reference](/reference/config/). For engine-specific install steps see [Switch engines](/guides/switch-engines/).

     </TabItem>
     <TabItem label="Prisma schema file">

   If you already have a Prisma schema file, introspect directly from it — no live database required:

   ```bash
   npx askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma
   ```

   You can also set this in `askdb.config.ts` so no flags are needed:

   ```ts
   introspection: {
     provider: "prisma",
     providerConfig: {
       prisma: { schemaPath: "./prisma/schema.prisma" },
     },
   },
   ```

     </TabItem>
   </Tabs>
   ```

   (The intro paragraph "Introspection produces an **AskDB schema artifact**…"
   already exists at lines 79; keep it above the Tabs, do not duplicate it.)

**Verify**: `cd apps/docs-site && pnpm lint` → exit 0. Then
`grep -c 'syncKey="engine"' apps/docs-site/src/content/docs/quickstart.mdx` → `1`,
and `grep -c "### From a Prisma schema" apps/docs-site/src/content/docs/quickstart.mdx` → `0`.

### Step 3: Explain why Studio is the place to ask — and that you embed afterward

In `quickstart.mdx`, the `### In Studio (recommended)` block (lines 151–153)
currently ends at "re-ask in the same session." Append a sentence connecting
asking-in-Studio to the eventual embed. Replace the block body with:

```mdx
### In Studio (recommended)

If Studio is already open from step 3, ask your question there. You'll see the generated SQL alongside the schema; if the answer isn't right, keep enriching descriptions, aliases, or concepts and re-ask in the same session.

Asking in Studio isn't the destination — it's how you dial in the enrichment until the SQL satisfies what your users actually need. Once you're happy with the answers, you embed the **same** schema artifact into your own app or service (see step 5) — Studio was just the place you tuned it.
```

**Verify**: `cd apps/docs-site && pnpm lint` → exit 0. Then
`grep -c "embed the \*\*same\*\* schema artifact" apps/docs-site/src/content/docs/quickstart.mdx` → `1`.

## Test plan

Docs/markup change — no unit tests. Verification is the build + link check:

- `cd apps/docs-site && pnpm test` → exit 0. Confirms the new Tabs parse, the
  SVG still loads via `?url`, and no internal links broke.

## Done criteria

ALL must hold:

- [ ] `cd apps/docs-site && pnpm lint` exits 0 with `0 errors`
- [ ] `cd apps/docs-site && pnpm test` exits 0
- [ ] SVG `viewBox` is `0 0 765 160`; box order in the file is init, introspect, ask (green), enrich (red); loop arrow comment reads "enrich → ask"
- [ ] Quickstart has one `<Tabs syncKey="engine">` and zero `### From a Prisma schema` headings
- [ ] The "In Studio (recommended)" block ends with the Studio-tuning-then-embed sentence
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since `4b80530`).
- Moving the live-DB prose into the tab would orphan or duplicate a paragraph
  you can't cleanly place — report the ambiguity rather than guessing.
- `astro check` reports an MDX parse error on the Tabs that you can't resolve by
  matching `install.mdx`'s exact fence/indentation pattern within two attempts.
- The SVG renders with overlapping or clipped text after the viewBox change
  (open the built page or the SVG in a viewer) — report instead of re-doing the
  coordinate math.

## Maintenance notes

- The `engine` syncKey is shared with other engine-variant pages; if a fifth
  engine is ever added, every `syncKey="engine"` tab set must gain the same new
  label or the sync silently desynchronizes.
- If plan 014's homepage workflow ("init → introspect → enrich → use") and this
  diagram's ask-before-enrich emphasis ever feel contradictory to a reviewer,
  the resolution is: the *pipeline* is init→introspect→enrich→use; the *loop*
  inside enrichment is ask⇄enrich. Keep both framings; they describe different
  granularities.
- A reviewer should eyeball the rendered SVG in both light and dark mode — the
  box fills are light-mode palette; if dark-mode legibility is poor, that's a
  pre-existing condition tracked under the deferred "per-theme diagram" item in
  `plans/README.md`, not a regression from this plan.
