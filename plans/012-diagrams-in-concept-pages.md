# Plan 012: Orphaned SVG diagrams are re-homed and the pipeline/quickstart loop get visuals

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bd751df..HEAD -- apps/docs-site/src/assets/diagrams apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx apps/docs-site/src/content/docs/reference/packages.mdx apps/docs-site/src/content/docs/quickstart.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/009-quickstart-fast-path.md and plans/011-studio-tour-page.md (both edit `quickstart.mdx`; run this after them)
- **Category**: docs
- **Planned at**: commit `bd751df`, 2026-06-12

## Why this matters

The site's two strongest conceptual claims — "AskDB stops at validated SQL;
your app owns execution" and "enrich, ask, re-enrich until generation is
good" — are currently prose-only. Meanwhile two finished, site-styled SVG
diagrams sit unused in `src/assets/diagrams/`: their `SOURCE.txt` says they
were imported from an `architecture.mdx` page that no longer exists in the
site. Re-homing the existing diagrams and adding one new "quickstart loop"
SVG gives the key pages a visual anchor at near-zero asset cost.

## Current state

- `apps/docs-site/src/assets/diagrams/` contains:
  - `askdb-hero-visual.svg` / `askdb-hero-visual-dark.svg` — used, inlined by
    `src/components/HomeHeroDiagram.astro`. **Do not touch.**
  - `askdb-runtime-boundary.svg` — unused. ViewBox `0 0 920 140`; titled
    "AskDB runtime boundary"; desc: "Flow from question and schema through
    ask to validated SQL and host-owned execution." Accessible markup
    (`role="img"`, `aria-labelledby`).
  - `askdb-package-dependencies.svg` — unused.
  - `SOURCE.txt` — says the SVGs "are imported from architecture.mdx via
    Vite (?url) so paths respect Astro `base`". No `architecture.mdx` exists
    under `src/content/docs/` (verified). Update this file as part of step 5.
- `apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx` — "The five
  steps" (numbered list, lines 10–20) and "## The runtime boundary" (prose,
  lines 22–32). No images.
- `apps/docs-site/src/content/docs/reference/packages.mdx` (253 lines) —
  package reference; no dependency diagram.
- `apps/docs-site/src/content/docs/quickstart.mdx` — after plan 009 it opens
  with a four-command fast path and the sentence about the enrich/re-ask
  loop. No visual.
- Image embedding convention for these diagrams (from `SOURCE.txt`): import
  with `?url` and render an `<img>` so Astro's base path is respected, e.g.:
  ```mdx
  import runtimeBoundaryUrl from "../../../assets/diagrams/askdb-runtime-boundary.svg?url";

  <img src={runtimeBoundaryUrl} alt="Flow from question and schema through ask() to validated SQL, with execution owned by your application" class="doc-diagram" />
  ```
  (Adjust the relative path depth per page location. A plain Markdown image
  `![...](../../assets/...)` also works through Astro assets; prefer the
  `?url` + `<img>` form because `SOURCE.txt` documents it and the SVGs are
  full-width banners.)
- Theme handling: the unused SVGs were authored for this site. Check their
  fill/stroke values render legibly on **both** light and dark themes by
  building and viewing, or by confirming they use the same palette approach
  as the hero SVGs. If a diagram is illegible in dark mode, wrap it in a
  `.doc-diagram` style with a light panel background in
  `src/styles/custom.css` rather than editing the SVG colors per theme.
- Current first-party package set, for auditing the dependency diagram
  (from `reference/packages.mdx` and the repo): `@askdb/core`,
  `@askdb/config`, `@askdb/introspect`, `@askdb/postgres`, `@askdb/mysql`,
  `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`, `@askdb/rag`,
  `@askdb/enrich`, `@askdb/tui`, `@askdb/studio`, `@askdb/http-api`,
  `@askdb/ai`, `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`,
  `@askdb/ai-anthropic`, `@askdb/ai-foundry` (verify the exact list against
  `packages/` and `apps/` directories before relying on it), plus the `askdb`
  CLI.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Lint site | `pnpm --filter @askdb/docs-site lint` | exit 0 |
| Build | `pnpm --filter @askdb/docs-site build` | exit 0 |
| Build + link check | `pnpm --filter @askdb/docs-site test` | exit 0 |
| Local preview (visual check) | `pnpm --filter @askdb/docs-site dev` | serves `http://127.0.0.1:4310` |

## Scope

**In scope** (the only files you should modify/create):
- `apps/docs-site/src/content/docs/concepts/how-askdb-works.mdx`
- `apps/docs-site/src/content/docs/reference/packages.mdx`
- `apps/docs-site/src/content/docs/quickstart.mdx` (one diagram insertion only)
- `apps/docs-site/src/assets/diagrams/askdb-quickstart-loop.svg` (create)
- `apps/docs-site/src/assets/diagrams/askdb-package-dependencies.svg`
  (label corrections only, if drifted — see step 3)
- `apps/docs-site/src/assets/diagrams/SOURCE.txt` (update provenance notes)
- `apps/docs-site/src/styles/custom.css` (only if a `.doc-diagram` style is needed)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `askdb-hero-visual*.svg` and `HomeHeroDiagram.astro` — the homepage hero
  is finished work.
- All other content pages.
- Do not add a diagram-generation toolchain (mermaid, d2, etc.) — these are
  hand-maintained SVGs by design.

## Git workflow

- Branch: `advisor/012-diagrams-in-concept-pages`
- Conventional commits, e.g. `docs(site): re-home runtime-boundary diagram into how-askdb-works`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Audit the two orphaned SVGs for accuracy

Open both SVG files and read every text label.

- `askdb-runtime-boundary.svg`: labels must agree with the current pipeline
  story (question + schema → `ask()` → validated SQL → host app executes).
  If labels mention removed concepts, STOP.
- `askdb-package-dependencies.svg`: compare each package name in the SVG to
  the actual workspace (`ls packages apps`). Missing packages (e.g. the
  `@askdb/ai*` family postdates the old architecture page) or stale ones
  must be corrected in step 3 — list the discrepancies before editing.

**Verify**: write the discrepancy list into your working notes (and final
report). An empty list is a valid result.

### Step 2: Embed the runtime-boundary diagram in "How AskDB works"

In `concepts/how-askdb-works.mdx`, insert the diagram at the top of the
"## The runtime boundary" section (before the bullet list), using the `?url`
import pattern from "Current state". Alt text must describe the flow, not
say "diagram".

**Verify**: `pnpm --filter @askdb/docs-site build` → exit 0; then
`grep -rn "askdb-runtime-boundary" apps/docs-site/dist/concepts/how-askdb-works/index.html` → at least one match.

### Step 3: Fix and embed the package-dependencies diagram in the package reference

1. Apply the label corrections from step 1 directly in
   `askdb-package-dependencies.svg` (text elements only; keep layout/style;
   adding a box for the `@askdb/ai` adapter family is in scope if a clean
   spot exists — if the layout can't absorb it cleanly, instead add a caption
   under the image in the page: "AI provider adapters (`@askdb/ai-*`) plug
   into the surfaces shown above." and note it in your report).
2. Embed at the top of `reference/packages.mdx` (after the lede), same
   pattern as step 2.

**Verify**: `pnpm --filter @askdb/docs-site build` → exit 0 and the dist
HTML for `reference/packages` references the SVG.

### Step 4: Create the quickstart-loop SVG and embed it

Create `askdb-quickstart-loop.svg` in the existing diagrams folder, matching
the visual style of `askdb-runtime-boundary.svg` (same font stack, stroke
weights, palette, accessible `<title>`/`<desc>`, `role="img"`). Content: four
nodes — **init** → **introspect** → **enrich (Studio)** → **ask** — with a
loop-back arrow from *ask* to *enrich* labeled "refine until the SQL is
right". Keep it a wide banner (similar viewBox proportions, e.g.
`0 0 920 140`–`0 0 920 180`) so it slots into the content column.

Embed it in `quickstart.mdx` directly under the four-command fast-path block
(added by plan 009), with alt text describing the loop.

**Verify**: `pnpm --filter @askdb/docs-site build` → exit 0; dist HTML for
`quickstart` references the new SVG. Then run the dev server and visually
confirm the new SVG is legible in both light and dark themes (toggle via the
site's theme select). If illegible in dark mode, add a `.doc-diagram`
panel style in `custom.css` and apply the class to all three embeds.

### Step 5: Update SOURCE.txt

Rewrite the first paragraph of `SOURCE.txt` to list, per SVG, the page(s)
that import it now (how-askdb-works, reference/packages, quickstart), keeping
the hero-visual paragraph unchanged.

**Verify**: `pnpm --filter @askdb/docs-site test` → exit 0.

## Test plan

Gates: `astro check`, full base-path build + link check, plus the dist-HTML
grep checks per step (these prove the images actually made it into the
output, which `astro check` alone does not). The dark-mode legibility check
in step 4 is visual; report what you saw.

## Done criteria

- [ ] `pnpm --filter @askdb/docs-site lint` exits 0
- [ ] `pnpm --filter @askdb/docs-site test` exits 0
- [ ] `grep -rln "diagrams/askdb-runtime-boundary" apps/docs-site/src/content` → `concepts/how-askdb-works.mdx`
- [ ] `grep -rln "diagrams/askdb-package-dependencies" apps/docs-site/src/content` → `reference/packages.mdx`
- [ ] `grep -rln "diagrams/askdb-quickstart-loop" apps/docs-site/src/content` → `quickstart.mdx`
- [ ] `askdb-quickstart-loop.svg` has `<title>` and `<desc>` elements
- [ ] `SOURCE.txt` no longer claims the diagrams are imported from `architecture.mdx`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `askdb-runtime-boundary.svg` labels contradict the current product story
  (e.g. they show AskDB executing SQL) — that needs a human design pass, not
  label surgery.
- The package-dependencies diagram is so far from the current workspace that
  fixing it means redrawing it (more than ~5 label changes or structural
  edge changes) — embed nothing on reference/packages and report instead.
- Plan 009's fast-path block is absent from `quickstart.mdx` (dependency not
  landed) — do steps 1–3 and 5, skip step 4's embed, and report.

## Maintenance notes

- These SVGs are hand-maintained build artifacts; any future package addition
  (new engine, new AI adapter) should update
  `askdb-package-dependencies.svg` — reviewers of such PRs should check.
- If the docs ever regain a full architecture page, `SOURCE.txt` is the
  provenance record to update again.
- Deferred: per-theme diagram variants (the hero's light/dark pattern). One
  neutral-palette version per diagram was chosen to keep maintenance at one
  file per concept.
