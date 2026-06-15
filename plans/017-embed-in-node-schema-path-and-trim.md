# Plan 017: Embed-in-Node — clarify the schema path, note the driver is optional, trim redundant sections

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/guides/embed-in-node.mdx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live file before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

The "Embed in a Node app" guide is the main integrator walkthrough, and three
things mislead or pad it:

1. **`loadSchema("./my-app.schema")` looks like a file with a `.schema`
   extension.** It isn't — `<name>.schema/` is AskDB's convention for the
   artifact **directory** that `askdb introspect` writes (see
   `concepts/the-schema-artifact.mdx`, which shows `my-app.schema/` as a folder,
   and the config `introspection.outputDir`). `loadSchema` autodetects a
   directory, a bundled JSON, or a bare `schema.json`
   (`packages/core/src/schema/v2/loader.ts:53`). The guide should make clear
   this path points at the introspected/enriched artifact directory.
2. **The handler example uses `pg` without saying it's optional.** AskDB never
   opens a connection — your app runs the SQL however it likes. A reader on
   Prisma/Drizzle/Sequelize shouldn't think `pg` is required; they just pass the
   returned SQL to their own client.
3. **Two sections add no real value here:** "Behind an HTTP route" (a hand-rolled
   `node:http` server) and "Handling errors". The dedicated
   [Deploy as HTTP service](/guides/deploy-as-http-service/) page owns the HTTP
   surface, and the error note is a generic try/catch. Removing both tightens
   the guide to its actual subject: load schema → `ask()` → run it yourself.

## Current state

`apps/docs-site/src/content/docs/guides/embed-in-node.mdx`:

- **"Load the schema once"** (lines 45–54):
  ```mdx
  ## Load the schema once

  The schema artifact is read from disk. Load it at startup and keep it in memory — it doesn't need to be reloaded per request.

  ```ts
  // schema.ts
  import { loadSchema } from "@askdb/core";

  export const schema = await loadSchema("./my-app.schema");
  ```
  ```

- **"Wire `ask()` into a handler"** (lines 56–90) — imports `pg`'s `Pool`,
  builds a pool, and runs `pool.query(sql)`. The trailing paragraph (line 90):
  "That's the whole pipeline. AskDB returns validated SQL — your handler logs
  it, runs it, and returns the result."

- **"Behind an HTTP route"** (lines 92–120) — a `node:http` server, ending with
  a paragraph pointing to `@askdb/http-api`.

- **"Handling errors"** (lines 122–138) — a try/catch around `ask()`.

- **"Switching engines"** (lines 140–142) and **"Read next"** (lines 144–151)
  follow and **stay**.

- The install table (lines 38–43) already explains `pg` is "The Postgres driver.
  AskDB doesn't open the connection; your app does." — reuse that framing.

- **Convention**: `<Aside type="note">…</Aside>` is the Starlight callout used
  site-wide for this kind of clarification; the component is already imported at
  the top of this file (`import { Tabs, TabItem } from "@astrojs/starlight/components";`
  — `Aside` must be **added** to that import in Step 2).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/docs-site/src/content/docs/guides/embed-in-node.mdx`

**Out of scope** (do NOT touch):
- `guides/deploy-as-http-service.mdx` — it already owns the HTTP surface; do not
  move the deleted HTTP example into it.
- The homepage embed snippet (`index.mdx`) — its `./my-app.schema` path is
  handled separately (plan 014 leaves it; this plan sets the canonical
  clarification here). Do not edit other files to "match."

## Git workflow

- Branch: `advisor/017-embed-in-node-cleanup`
- Commit style: conventional, e.g. `docs(embed): clarify artifact path, note optional driver, trim redundant sections`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Clarify that the schema path is the artifact directory

In the "Load the schema once" section, replace the code comment and add a
clarifying line. Target:

```mdx
## Load the schema once

The schema artifact is read from disk. Load it at startup and keep it in memory — it doesn't need to be reloaded per request.

```ts
// schema.ts
import { loadSchema } from "@askdb/core";

// Point at the artifact directory that `askdb introspect` wrote —
// your `introspection.outputDir` (e.g. ./my-app.schema or the default ./askdb).
// loadSchema also accepts a bundled .bundle.json file.
export const schema = await loadSchema("./my-app.schema");
```

`./my-app.schema` is a **directory**, not a file — `<name>.schema/` is AskDB's convention for the introspected-and-enriched artifact. `loadSchema` autodetects a directory, a bundled JSON, or a bare `schema.json`.
```

**Verify**: `grep -c "is a \*\*directory\*\*, not a file" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `1`.

### Step 2: Note that the database driver is your choice, not a requirement

First, add `Aside` to the Starlight import at the top of the file. Change:

```mdx
import { Tabs, TabItem } from "@astrojs/starlight/components";
```

to:

```mdx
import { Tabs, TabItem, Aside } from "@astrojs/starlight/components";
```

Then, in the "Wire `ask()` into a handler" section, **immediately after** the
closing ``` ``` `` of the handler code block and **before** the paragraph
"That's the whole pipeline…", insert this callout:

```mdx
<Aside type="note">
This example uses `pg` to run the SQL, but the driver is your choice — AskDB never opens a connection. If you already use an ORM or query builder (Prisma, Drizzle, Sequelize, Knex, …), skip `pg` entirely and pass the returned `sql` string to your existing client, e.g. `prisma.$queryRawUnsafe(sql)` or `db.execute(sql)`.
</Aside>
```

**Verify**: `grep -c "the driver is your choice" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `1`. And
`grep -c ", Aside }" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `1`.

### Step 3: Remove the "Behind an HTTP route" and "Handling errors" sections

Delete both sections in full:

- `## Behind an HTTP route` and its `node:http` code block and the trailing
  `@askdb/http-api` paragraph (current lines 92–120).
- `## Handling errors` and its try/catch block (current lines 122–138).

The section order after this step must be: "Wire `ask()` into a handler" (with
its new Aside) → **"Switching engines"** → "Read next". Do not delete or alter
"Switching engines" or "Read next".

**Verify**: `grep -c "## Behind an HTTP route" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `0`. And
`grep -c "## Handling errors" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `0`. And
`grep -c "## Switching engines" apps/docs-site/src/content/docs/guides/embed-in-node.mdx` → `1`.

## Test plan

Docs change — no unit tests. Gate is the build + link check:

- `cd apps/docs-site && pnpm test` → exit 0. Confirms the page still parses and
  removing the two sections didn't orphan any in-page anchor links (none point
  at the removed headings; the grep in "Done criteria" confirms it).

## Done criteria

ALL must hold:

- [ ] The "Load the schema once" section states `./my-app.schema` is a directory
      and that `loadSchema` autodetects directory / bundle / `schema.json`
- [ ] The handler section has an `<Aside type="note">` saying the driver is
      optional and naming ORMs (Prisma/Drizzle/Sequelize)
- [ ] `## Behind an HTTP route` and `## Handling errors` are gone; "Switching
      engines" and "Read next" remain
- [ ] `grep -rn "#behind-an-http-route\|#handling-errors" apps/docs-site/src` →
      no matches (nothing linked to the removed anchors)
- [ ] `cd apps/docs-site && pnpm lint` exits 0; `pnpm test` exits 0
- [ ] Only `embed-in-node.mdx` is modified (`git status`)
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live file (drift since `4b80530`).
- Some other page links to `#behind-an-http-route` or `#handling-errors`
  (the grep finds matches) — report it before deleting, so the link can be
  repointed.
- `astro check` errors on the `<Aside>` because the import edit didn't take —
  recheck the import line matches Step 2 exactly.

## Maintenance notes

- This plan establishes the canonical wording that the artifact path is a
  directory. If a future cleanup standardizes the example path across the site
  (homepage `index.mdx`, config reference, quickstart all currently use
  `./my-app.schema` while the config *default* is `./askdb/`), reconcile them in
  one pass — but that is out of scope here.
- A reviewer should confirm the HTTP content genuinely lives in
  `guides/deploy-as-http-service.mdx` so nothing unique was lost by deleting the
  "Behind an HTTP route" block.
