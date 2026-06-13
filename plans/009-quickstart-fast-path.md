# Plan 009: Quickstart leads with a four-command fast path and shows what success looks like

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat bd751df..HEAD -- apps/docs-site/src/content/docs/quickstart.mdx apps/docs-site/editorial-changes.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `bd751df`, 2026-06-12

## Why this matters

AskDB has not been announced yet; the docs site carries the entire first
impression. The Quickstart's job is to get a visitor to a working `askdb ask`
as fast as possible, but today the page spends its first ~48 lines explaining
config files, the `env()` helper, and `.env` semantics before the reader has
run anything that produces visible value. The page also never shows what the
output of `askdb ask` looks like, so a reader cannot picture the payoff. This
plan front-loads a four-command "fast path", trims the config theory down to
what's needed in the moment, and shows expected output — without removing any
information (details move to asides or links to the Configuration reference).
It also removes a leftover internal editorial-review file from the app root,
preserving its still-useful style guide.

## Current state

- `apps/docs-site/src/content/docs/quickstart.mdx` — the Quickstart page
  (164 lines). Structure today:
  - frontmatter + lede (lines 1–8)
  - `## Prerequisites` (lines 10–15)
  - `## 1. Scaffold your config` (lines 17–65) — contains `npx askdb@latest init`,
    a paragraph explaining `npx` and the `env()` helper, a 7-line fragment
    showing `apiKey: env("OPENAI_API_KEY")`, the sentence
    `` `askdb.config.ts` is checked in; `.env` is not. ``, then a 24-line
    `defineConfig` example (lines 37–61), then pointers to the Configuration
    reference.
  - `## 2. Introspect your database` (lines 67–115) — `npx askdb introspect`,
    with subsections "From a live database" and "From a Prisma schema".
  - `## 3. Enrich and test in Studio` (lines 117–135) — `npx askdb studio`,
    TUI alternative `npx askdb enrich`.
  - `## 4. Ask your question` (lines 137–153) — Studio path and CLI path
    (`npx askdb ask --question "Which customers signed up last week?"`).
    Ends with: "In both cases AskDB returns validated SQL. It does **not**
    run it against your database — your application owns execution."
  - `## 5. From here` (lines 155–164) — a `home-path-grid` of next links.
- `apps/docs-site/editorial-changes.md` — 475 lines of internal editorial
  review notes committed in PR #64. Every recommendation in it is marked ✅
  (already applied). Lines 287–310 contain an "Editorial style guide for the
  AskDB docs" section (term preferences like "schema artifact" over
  "describable schema", and a list of jargon to avoid early) that is still
  useful guidance for future docs authors. The rest is done work.
- Conventions on this page: section intros are plain prose; custom CSS classes
  `doc-eyebrow`, `doc-lede`, and `home-path-grid` are used (see
  `quickstart.mdx:6-8` and `quickstart.mdx:159-164` as exemplars). Starlight
  components are available from `@astrojs/starlight/components` — the site is
  on `@astrojs/starlight` `^0.40.0` (see `apps/docs-site/package.json`),
  which includes the `Aside` component, but no Starlight components are
  imported on this page today.
- Fact constraints you must not violate (verified against the repo at
  planning time):
  - The CLI commands are real: `init`, `introspect`, `enrich`, `studio`,
    `bundle`, `ask` (`apps/cli/src/cli.ts:237-268`).
  - `askdb ask` prints validated SQL to stdout and does not execute it
    (`apps/docs-site/src/content/docs/reference/cli.mdx:122`).
  - `askdb ask --schema` is optional; it falls back to
    `introspection.outputDir` from config (`reference/cli.mdx:112`).
  - Running `askdb ask` for real requires a model API key; you cannot run it
    in this worktree, so any sample output you show must be labeled as an
    example.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Typecheck/lint the site | `pnpm --filter @askdb/docs-site lint` | exit 0 (runs `astro check`) |
| Build | `pnpm --filter @askdb/docs-site build` | exit 0 |
| Build + link check | `pnpm --filter @askdb/docs-site test` | exit 0 (base-path build, then `check-base-links`) |

## Scope

**In scope** (the only files you should modify):
- `apps/docs-site/src/content/docs/quickstart.mdx`
- `apps/docs-site/editorial-changes.md` (delete)
- `apps/docs-site/STYLE.md` (create)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `apps/docs-site/src/content/docs/install.mdx` and all guide pages — plan 010
  owns tab work on those pages.
- `apps/docs-site/astro.config.mjs` — sidebar changes belong to plan 011.
- The homepage (`index.mdx`) and its components.
- Any `packages/*` or `apps/cli` source.

## Git workflow

- Branch: `advisor/009-quickstart-fast-path`
- Commit style: conventional, matching repo history (e.g.
  `docs(site): lead quickstart with a four-command fast path`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a "fast path" block immediately after Prerequisites

In `quickstart.mdx`, insert a new section between `## Prerequisites` and
`## 1. Scaffold your config`:

```markdown
## The whole flow, in four commands

```bash
npx askdb@latest init        # scaffold askdb.config.ts
npx askdb introspect         # read your database into a schema artifact
npx askdb studio             # enrich the schema and test questions in your browser
npx askdb ask --question "Which customers signed up last week?"
```

Each step is explained below. The loop that makes answers good: **introspect
once, then enrich and re-ask in Studio until the SQL matches how your team
thinks about the data.**
```

Keep the exact commands as shown — they match the CLI surface. (The fenced
block inside this plan is illustrative of content, not indentation; produce a
normal top-level code fence in the page.)

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 2: Tighten "1. Scaffold your config"

Goal: cut the section roughly in half without losing facts; details move to
the Configuration reference link that is already present.

- Keep `npx askdb@latest init` and one short paragraph: `npx` runs the CLI
  without installing; `init` creates a TypeScript-checked `askdb.config.ts`
  that reads values from your environment via the `env()` helper (from `.env`
  or the system environment).
- Delete the standalone 7-line fragment (`{ ... apiKey: env("OPENAI_API_KEY") ... }`,
  lines 25–31 today) — the full example below it already shows the same thing.
- Convert the sentence `` `askdb.config.ts` is checked in; `.env` is not. ``
  into a Starlight aside. Add the import at the top of the file (after the
  frontmatter, with the existing imports if any — this page currently has
  none):
  ```mdx
  import { Aside } from "@astrojs/starlight/components";
  ```
  and use:
  ```mdx
  <Aside type="tip">`askdb.config.ts` is checked in; `.env` (your real keys) is not.</Aside>
  ```
- Keep the 24-line `defineConfig` example exactly as-is (it is accurate per
  plan 008's accuracy sweep) and keep both closing pointer sentences and the
  "Once this is configured, most CLI flags below are optional." line.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 3: Show what success looks like in "4. Ask your question"

In the "From the CLI" subsection, immediately after the existing
`npx askdb ask --question ...` block, add an example-output block:

```markdown
You get validated SQL on stdout — for example:

```sql
SELECT c.id, c.name, c.signed_up_at
FROM customers AS c
WHERE c.signed_up_at >= NOW() - INTERVAL '7 days'
ORDER BY c.signed_up_at DESC;
```
```

Label notes: the prose "for example" is the label; do not present the SQL as
deterministic output. Keep the existing closing paragraph ("In both cases
AskDB returns validated SQL. It does **not** run it...") unchanged — it must
remain the last word of the section.

**Verify**: `pnpm --filter @askdb/docs-site lint` → exit 0.

### Step 4: Extract the style guide, then delete the editorial notes

1. Create `apps/docs-site/STYLE.md` containing:
   - a 2–3 line header explaining this is the editorial style guide for the
     docs site, extracted from the 2025 editorial review,
   - the verbatim content of the "Editorial style guide for the AskDB docs"
     section of `editorial-changes.md` (the `### Prefer` and
     `### Avoid using too early` lists, lines 287–310 today).
2. `git rm apps/docs-site/editorial-changes.md`

**Verify**: `test ! -f apps/docs-site/editorial-changes.md && test -f apps/docs-site/STYLE.md && echo OK` → `OK`

### Step 5: Full site verification

**Verify**: `pnpm --filter @askdb/docs-site test` → exit 0 (builds with
`ASTRO_BASE=/AskDB` and runs the internal link checker).

## Test plan

No unit tests exist for docs content. The verification gates are
`astro check` (MDX/component validity) and the base-path build + link check
(`pnpm --filter @askdb/docs-site test`), which catches broken internal links
introduced by edits.

## Done criteria

- [ ] `pnpm --filter @askdb/docs-site lint` exits 0
- [ ] `pnpm --filter @askdb/docs-site test` exits 0
- [ ] `grep -n "whole flow, in four commands" apps/docs-site/src/content/docs/quickstart.mdx` → one match, located before the "Scaffold your config" heading
- [ ] `grep -c "env(\"OPENAI_API_KEY\")" apps/docs-site/src/content/docs/quickstart.mdx` → `1` (the standalone fragment is gone; the full config example remains)
- [ ] `test ! -f apps/docs-site/editorial-changes.md` passes; `apps/docs-site/STYLE.md` exists and contains "schema artifact"
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `quickstart.mdx` no longer matches the section layout described in
  "Current state" (someone restructured it since `bd751df`).
- `astro check` fails on the `Aside` import (would indicate the Starlight
  version no longer exports it — do not vendor a substitute).
- You find the CLI commands in the fast path no longer exist in
  `apps/cli/src/cli.ts` — the docs must not advertise dead commands.
- The "Editorial style guide" section is not at `editorial-changes.md:287-310`
  — locate it by its heading text; if the heading is absent entirely, delete
  nothing and report.

## Maintenance notes

- Plans 010 (tabs), 011 (Studio tour page), and 012 (diagrams) also touch or
  link into `quickstart.mdx`; this plan must land first to avoid conflicts.
- Reviewer should check that the fast-path commands stay in sync with
  `apps/cli/src/cli.ts` command names, and that no factual claims were
  introduced about `askdb ask` executing SQL (it never does).
- Deferred: converting the numbered `## 1.`–`## 5.` headings to Starlight's
  `<Steps>` component was considered and skipped — the sections are long-form
  with subsections, which `<Steps>` handles poorly.
