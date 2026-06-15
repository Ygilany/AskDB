# Plan 016: Retire the standalone Install page — fold its one unique asset into the Packages reference

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **The maintainer approved removing this page on
> 2026-06-14 — the prior decision gate is resolved; proceed.** When done, update
> the status row for this plan in `plans/README.md` — unless a reviewer
> dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/install.mdx apps/docs-site/astro.config.mjs apps/docs-site/src/content/docs/reference/packages.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (removes a page from navigation)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14
- **Decision**: maintainer approved removal on 2026-06-14.

## Why this matters

The maintainer asked whether the standalone **Install** page should exist at
all, and approved removing it. The evidence:

- **Zero inbound content links.** `grep -rn "/install/"` across the docs source
  finds the page only in the Start sidebar (`astro.config.mjs`) — no guide,
  concept, or reference page links to it.
- **Fully duplicated.** Its content is per-package install commands (CLI, core,
  engines, AI providers, authoring, introspection, RAG, HTTP) wrapped in
  npm/pnpm/yarn Tabs. Quickstart already shows `npx askdb` as the on-ramp, and
  `reference/packages.mdx` already lists every `@askdb/*` package with its
  purpose, an install line, key exports, and a dependency-direction table. The
  Install page is a third place saying the same things.
- **One genuinely unique asset:** the "What to install — by use case" decision
  grid at the bottom (`install.mdx:304-311`) — "Just trying it out", "Embedding
  in a Node service", "Standing up an HTTP service", "Working with a large
  schema". That grid is worth keeping; the rest is redundant.

Recommended change: **remove the standalone Install page**, **fold the use-case
grid into `reference/packages.mdx`**, **drop "Install" from the Start nav**, and
**add a redirect** so any external `/install/` link still resolves. This cuts a
maintenance surface (every package add currently means editing install commands
in two files) without losing the one helpful decision aid.

## Current state

- `apps/docs-site/src/content/docs/install.mdx` — the page to remove. ~311
  lines: requirements, then `## The CLI`, `## Embedding in a Node app`,
  `## Model provider`, `## Authoring the schema`, `## Introspection`,
  `## Retrieval (RAG)`, `## HTTP service`, each a npm/pnpm/yarn `<Tabs
  syncKey="pkg">` block, then `## What to install — by use case`. The unique
  grid (lines 304–311):
  ```mdx
  ## What to install — by use case

  <div class="home-path-grid">
    <a href="/quickstart/"><strong>Just trying it out</strong><span><code>askdb</code> alone is enough to introspect, enrich, and ask from the CLI.</span></a>
    <a href="/guides/embed-in-node/"><strong>Embedding in a Node service</strong><span><code>@askdb/core</code> + one engine adapter + a model provider.</span></a>
    <a href="/guides/deploy-as-http-service/"><strong>Standing up an HTTP service</strong><span>Add <code>@askdb/http-api</code> on top of the embedding install.</span></a>
    <a href="/guides/rag-for-large-schemas/"><strong>Working with a large schema</strong><span>Add <code>@askdb/rag</code> and a vector store (pgvector recommended).</span></a>
  </div>
  ```

- `apps/docs-site/astro.config.mjs` — top-level Astro `defineConfig({...})`
  begins at the `export default defineConfig({` line; it currently has **no**
  `redirects` key. The Start sidebar group is:
  ```js
  {
    label: "Start",
    items: [
      { label: "Overview", slug: "index" },
      { label: "Quickstart", slug: "quickstart" },
      { label: "Studio", slug: "studio" },
      { label: "Install", slug: "install" },
    ],
  },
  ```
  `base` is set to `/AskDB` in production (the `base` const near the top of the
  file). Astro applies `base` to `redirects` keys automatically.

- `apps/docs-site/reference/packages.mdx` — ends with a `## Read next`
  `home-path-grid` (the last block in the file). This is where the use-case grid
  will be folded in, as a new section **before** `## Read next`.

- `apps/docs-site/scripts/check-base-links.mjs` — the link checker run by
  `pnpm test`. It will fail the build if any internal link points to a page that
  no longer exists, so removing `install.mdx` requires removing all links *to*
  it first (there are none in content — only the nav entry, handled in Step 2).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 (no broken links) |
| Confirm no inbound links remain | `grep -rn "/install/" apps/docs-site/src` | only matches you expect (after Step 2: none, or only the redirect) |

## Scope

**In scope**:
- `apps/docs-site/src/content/docs/install.mdx` (delete)
- `apps/docs-site/astro.config.mjs` (remove nav item, add redirect)
- `apps/docs-site/src/content/docs/reference/packages.mdx` (add use-case grid)

**Out of scope** (do NOT touch):
- Any guide/concept page. Their content does not reference `/install/`.
- The `pkg` syncKey Tabs elsewhere — they stay; only this page's copies go.
- `check-base-links.mjs` — do not edit the checker to make the build pass;
  fix the actual links.

## Git workflow

- Branch: `advisor/016-retire-install-page`
- Commit style: conventional, e.g. `docs: retire standalone install page, fold use-case grid into packages reference`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fold the use-case grid into the Packages reference

In `apps/docs-site/src/content/docs/reference/packages.mdx`, add a new section
**immediately before** the final `## Read next` block:

```mdx
## What to install — by use case

<div class="home-path-grid">
  <a href="/quickstart/"><strong>Just trying it out</strong><span><code>askdb</code> alone is enough to introspect, enrich, and ask from the CLI.</span></a>
  <a href="/guides/embed-in-node/"><strong>Embedding in a Node service</strong><span><code>@askdb/core</code> + one engine adapter + a model provider.</span></a>
  <a href="/guides/deploy-as-http-service/"><strong>Standing up an HTTP service</strong><span>Add <code>@askdb/http-api</code> on top of the embedding install.</span></a>
  <a href="/guides/rag-for-large-schemas/"><strong>Working with a large schema</strong><span>Add <code>@askdb/rag</code> and a vector store (pgvector recommended).</span></a>
</div>
```

**Verify**: `grep -c "What to install — by use case" apps/docs-site/src/content/docs/reference/packages.mdx` → `1`.

### Step 2: Remove the Install nav item and add a redirect

In `apps/docs-site/astro.config.mjs`:

1. Delete the `{ label: "Install", slug: "install" }` line from the Start
   sidebar `items` array.

2. Add a top-level `redirects` key to the `defineConfig({...})` object (a
   sibling of `site`, `base`, `markdown`, `integrations` — not inside
   `starlight(...)`). Place it just after the `base,` line:

   ```js
   redirects: {
     "/install": "/reference/packages/",
   },
   ```

**Verify**: `grep -c '"/install"' apps/docs-site/astro.config.mjs` → `1` (the
redirect). `grep -c 'slug: "install"' apps/docs-site/astro.config.mjs` → `0`.

### Step 3: Delete the Install page

Delete `apps/docs-site/src/content/docs/install.mdx`.

**Verify**: `test ! -f apps/docs-site/src/content/docs/install.mdx && echo gone`
→ `gone`. Then `grep -rn "/install/" apps/docs-site/src/content` → no matches
(no content page links to the removed page).

### Step 4: Full build + link check

**Verify**: `cd apps/docs-site && pnpm test` → exit 0. The base-path build must
succeed and `check-base-links.mjs` must report no broken internal links. If the
redirect causes a build error, see STOP conditions.

## Test plan

No unit tests. The gate is `pnpm test` (build + link check) passing with the
page removed, plus a manual confirmation that visiting `/install/` redirects to
`/reference/packages/` (the executor can confirm the redirect entry exists in
the build output under `dist/install/` or `dist/AskDB/install/`).

## Done criteria

ALL must hold:

- [ ] `install.mdx` no longer exists
- [ ] `astro.config.mjs` has no `slug: "install"` nav item and has a
      `"/install"` redirect to `/reference/packages/`
- [ ] `reference/packages.mdx` contains the "What to install — by use case" grid
- [ ] `grep -rn "/install/" apps/docs-site/src/content` returns no matches
- [ ] `cd apps/docs-site && pnpm test` exits 0
- [ ] Only the three in-scope files are modified/deleted (`git status`)
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since `4b80530`).
- `pnpm test` fails because Astro's `redirects` doesn't compose with the `/AskDB`
  base as assumed (e.g. the redirect 404s or the build errors). In that case,
  report it — the fallback is to keep a minimal `install.mdx` stub that just
  renders the use-case grid and links to the packages reference, rather than a
  config redirect. Do not spend more than two attempts on the redirect.
- A content page *does* link to `/install/` (the grep in Step 3 finds matches) —
  report which pages; they need redirecting to a real target first.

## Maintenance notes

- **Alternative the maintainer may prefer (keep-but-slim):** instead of deleting,
  reduce `install.mdx` to just the requirements blurb + the use-case grid + a
  one-line "per-package install commands live in the [Package
  reference](/reference/packages/)" pointer, and leave the nav entry. This keeps
  a discoverable "Install" landing without the duplicated command matrix. Pick
  this only if the maintainer wants to preserve the nav slot.
- After this lands, the single source of truth for per-package install is
  `reference/packages.mdx`. Any new `@askdb/*` package adds its install line
  there only — there is no longer a second place to keep in sync.
- A reviewer should confirm the redirect resolves in the deployed
  (GitHub Pages, base `/AskDB`) environment, not just local `astro dev` where
  base is `/`.
