# Plan 011: Studio gets a visual tour page in the Start section, with real screenshots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bd751df..HEAD -- apps/docs-site/astro.config.mjs apps/docs-site/src/content/docs/quickstart.mdx apps/docs-site/src/content/docs/guides/author-your-schema.mdx apps/studio/src/web`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (docs only; screenshot tooling runs in your worktree)
- **Depends on**: plans/009-quickstart-fast-path.md (both edit `quickstart.mdx`)
- **Category**: docs
- **Planned at**: commit `bd751df`, 2026-06-12

## Why this matters

Studio is the product's most engaging surface — a local browser UI with seven
views (overview dashboard, table enrichment, concepts, tenancy, RAG index,
NL→SQL playground, settings) — and the docs call it "the recommended
authoring surface". Yet the docs site contains **zero images of any kind**
(verified: no `img`/`png`/`svg` references in any of the 21 content pages),
no Studio sidebar entry, and only two short paragraphs about it. For an
unannounced product, a visitor must install and run AskDB before they can see
its best feature. This plan adds a "Studio" page to the Start sidebar group
with a screenshot-led tour of the enrich → ask → re-enrich loop.

## Current state

- `apps/docs-site/astro.config.mjs` — sidebar config; the `Start` group is:
  ```js
  { label: "Start", items: [
    { label: "Overview", slug: "index" },
    { label: "Quickstart", slug: "quickstart" },
    { label: "Install", slug: "install" },
  ]},
  ```
- `apps/docs-site/src/content/docs/quickstart.mdx` — section
  "3. Enrich and test in Studio" describes Studio in prose and links only to
  `guides/author-your-schema`. (Plan 009 may have restructured the top of the
  page; the Studio section is unchanged by it.)
- `apps/docs-site/src/content/docs/guides/author-your-schema.mdx` — the
  authoring guide; "Authoring in Studio" section (lines 14–32) lists what's
  editable. This page remains the *workflow* guide; the new page is the
  *visual tour* — they link to each other, they don't duplicate.
- Studio app facts (verified in `apps/studio`):
  - Launch: `npx askdb studio` (reads `outputDir` from config) or
    `askdb-studio --schema <dir>`; serves `http://127.0.0.1:5556` by default
    (`apps/studio/README.md`, `apps/studio/src/cli.ts:131-135`).
  - Views/routes (`apps/studio/src/web/App.tsx:81-`): `/overview`, `/tables`
    (with Enrichment / Schema / Sensitivity tabs per table), `/concepts`,
    `/tenancy`, `/rag-index`, `/playground`, `/settings`.
  - `ASKDB_MOCK_SQL` env var gives deterministic generated SQL for offline
    demos (`apps/studio/README.md`).
  - AI suggestions and live NL→SQL need a model key; mock mode does not.
  - Dev run from repo root:
    `pnpm --filter @askdb/studio build` then
    `pnpm --filter @askdb/studio start -- --schema ./fixtures/schemas/orders-users.schema`
    (the README shows the same command with a relative path from the package
    dir; from the repo root use the path shown here — confirm the fixture
    exists at `fixtures/schemas/orders-users.schema/`).
- Image conventions in the site: none exist yet for content pages. Starlight
  renders standard Markdown images through Astro's asset pipeline when the
  file lives under `src/assets/` and is referenced by relative path, e.g.
  `![Alt text](../../assets/studio/overview.png)` from a page at
  `src/content/docs/studio.mdx`. Brand assets already live under
  `src/assets/brand/`; put screenshots in `src/assets/studio/`.
- The site supports light and dark themes (custom `ThemeSelect.astro`).
  Studio itself has a theme toggle (`apps/studio/src/web/contexts/theme-context.tsx`).
  Capture **light-theme** screenshots only — consistent and readable on both
  site themes inside the default Starlight image frame.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Build studio | `pnpm --filter @askdb/studio build` | exit 0 |
| Run studio (mock SQL) | `ASKDB_MOCK_SQL=1 pnpm --filter @askdb/studio start -- --schema ./fixtures/schemas/orders-users.schema` | serves on `http://127.0.0.1:5556` |
| Screenshot (example) | `npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 "http://127.0.0.1:5556/overview" overview.png` | PNG written |
| Playwright browser (one-time) | `npx playwright install chromium` | exit 0 |
| Lint site | `pnpm --filter @askdb/docs-site lint` | exit 0 |
| Build + link check | `pnpm --filter @askdb/docs-site test` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `apps/docs-site/src/content/docs/studio.mdx` (create)
- `apps/docs-site/src/assets/studio/*.png` (create, ~4–6 screenshots)
- `apps/docs-site/astro.config.mjs` (one sidebar entry)
- `apps/docs-site/src/content/docs/quickstart.mdx` (link only, in step 3's section)
- `apps/docs-site/src/content/docs/guides/author-your-schema.mdx` (link only)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any `apps/studio` source — if Studio looks broken or a view errors, STOP
  and report; do not fix the app.
- The homepage and its components (a future pass may feature a screenshot
  there; not this plan).
- All other docs pages.

## Git workflow

- Branch: `advisor/011-studio-tour-page`
- Conventional commits, e.g. `docs(site): add Studio tour page with screenshots`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Run Studio against the fixture schema and capture screenshots

1. `pnpm install && pnpm build` (Studio's start script needs built workspace
   deps; `pnpm build` is the repo-standard turbo build).
2. Start Studio with mock SQL (no API key needed):
   `ASKDB_MOCK_SQL=1 pnpm --filter @askdb/studio start -- --schema ./fixtures/schemas/orders-users.schema`
   Confirm `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5556/` → `200`.
3. `npx playwright install chromium` (skip if already installed).
4. Capture at viewport 1440×900, light theme, with a 2–3s wait for data to
   load, into `apps/docs-site/src/assets/studio/`:
   - `overview.png` — `/overview`
   - `tables.png` — `/tables` (then, if the table list requires clicking a
     table to show detail, capture the first table's Enrichment tab; if
     URL-addressable like `/tables/<id>`, use the URL — inspect the running
     app to find a stable URL; otherwise capture the list view and name it
     accordingly)
   - `concepts.png` — `/concepts`
   - `playground.png` — `/playground` (if the mock allows, type a question
     and generate SQL first so the screenshot shows a result; a list-only
     empty state is acceptable as fallback)
   - `tenancy.png` — `/tenancy`
5. Visually inspect each PNG (open the file). Reject and recapture any image
   that shows a loading skeleton, an error banner, or an empty viewport.
6. Stop the Studio process.

**Verify**: `ls apps/docs-site/src/assets/studio/*.png | wc -l` → ≥ 4, and
each file > 30 KB (`du -k`) — tiny files indicate blank captures.

### Step 2: Write the Studio page

Create `apps/docs-site/src/content/docs/studio.mdx`. Follow the established
page pattern (`doc-eyebrow`, `doc-lede`, `home-path-grid` footer — copy the
shape from `guides/author-your-schema.mdx`). Content outline:

1. Frontmatter: title `"Studio"`, description ~"A local browser UI for
   enriching your schema and testing questions — the fastest way to see
   AskDB work."
2. Lede: what Studio is (local web app, reads/writes your schema artifact
   directly, nothing leaves your machine) + launch command `npx askdb studio`.
3. `## The loop` — 3 sentences on enrich → ask → re-enrich being the core
   workflow, referencing the playground.
4. One `##` section per captured view (Overview, Tables & enrichment,
   Concepts, Playground, Tenancy), each: screenshot image with meaningful
   alt text, then 2–4 sentences grounded in the verified capabilities list
   (from `apps/studio/README.md`: edit descriptions/aliases/tags/example
   questions, sensitivity markers, AI-assisted drafts always human-confirmed,
   RAG index build/query, NL→SQL with tenant scope, sql-only vs sql-params
   output).
5. `## Studio and your data` — short: binds to `127.0.0.1` by default;
   the model sees schema text, not rows; AI features are optional and only
   active when a key is configured.
6. Footer grid linking: Quickstart, Author your schema, Multi-tenancy,
   RAG for large schemas.

Accuracy rule: every capability sentence must be traceable to
`apps/studio/README.md` or to what you saw running the app. No promises about
features you did not see.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 3: Add the sidebar entry

In `apps/docs-site/astro.config.mjs`, add to the `Start` group after
Quickstart:

```js
{ label: "Studio", slug: "studio" },
```

**Verify**: `pnpm --filter @askdb/docs-site build` → exit 0, and
`grep -n '"studio"' apps/docs-site/astro.config.mjs` shows the entry.

### Step 4: Cross-link from existing pages

- `quickstart.mdx`, in the "3. Enrich and test in Studio" section: add one
  sentence linking to the new page, e.g.
  `See the [Studio tour](/studio/) for what each view does.`
- `guides/author-your-schema.mdx`, "Authoring in Studio" section: add the
  same style of link.

Use root-absolute links (`/studio/`) — the site's remark plugin rebases them
for the GitHub Pages base path (`astro.config.mjs:15-40`).

**Verify**: `pnpm --filter @askdb/docs-site test` → exit 0 (link checker
covers the new internal links under the `/AskDB` base).

## Test plan

Gates: `astro check`, full base-path build, and the internal link checker
(`pnpm --filter @askdb/docs-site test`). Visual check of each screenshot is
step 1.5 — that judgment cannot be automated; record in your report which
views you captured and any view you had to fall back to an empty state for.

## Done criteria

- [ ] `pnpm --filter @askdb/docs-site lint` exits 0
- [ ] `pnpm --filter @askdb/docs-site test` exits 0
- [ ] `apps/docs-site/src/content/docs/studio.mdx` exists; ≥ 4 image
      references resolve to files in `src/assets/studio/`
- [ ] Sidebar shows Studio in the Start group (grep check in step 3)
- [ ] Quickstart and author-your-schema each link to `/studio/`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Studio fails to start against the fixture schema, or any view renders an
  error — that's an app bug to report, not to patch.
- You cannot run a headless browser in this environment after two attempts
  (e.g. Playwright cannot launch Chromium). Fallback: write the page and
  sidebar/link changes anyway with HTML comments
  `{/* TODO screenshot: <view> */}` in place of images, and report that
  screenshots need a human/machine with a browser.
- `fixtures/schemas/orders-users.schema/` does not exist or fails to load.
- The Studio routes listed in "Current state" don't match the running app
  (App.tsx drifted).

## Maintenance notes

- Screenshots go stale as Studio's UI evolves. Reviewer should note in the
  PR that any future Studio UI change should re-run step 1 (the commands are
  reproducible from this plan). Consider a follow-up to script the capture
  (`scripts/` dir exists in docs-site) — deferred from this plan.
- Plan 013 (studio-first onboarding spike) proposes deeper Studio changes;
  if executed later, this page is where the resulting flows get documented.
- The homepage deliberately doesn't get a screenshot in this plan (its hero
  is an SVG system diagram); revisit after the page exists and the team can
  judge whether a Studio shot belongs above the fold.
