# Plan 023: Quickstart — align the Prisma tab's block order with the Live database tab

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat dfd44f5..HEAD -- apps/docs-site/src/content/docs/quickstart.mdx`
> If that file changed since this plan was written, compare the "Current state"
> excerpts below against the live file before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 022 (DONE — this fixes a layout inconsistency 022 introduced)
- **Category**: docs
- **Planned at**: commit `dfd44f5`, 2026-06-15

## Why this matters

Plan 022 made the quickstart's "Prisma schema file" tab teach config-first
(correct: flag-free `npx askdb introspect` works). But it did so by putting the
**config snippet physically first and the command second**, while the sibling
"Live database" tab does the opposite — **command first, config snippet second**
as a "For example" block. The two tabs live in the same `<Tabs syncKey="engine">`
group and switch in place, so the reordering between them is visible and reads as
sloppy: the same step is laid out two different ways depending on which tab you
click.

Both tabs already say the same thing in substance (config drives a bare
`npx askdb introspect`; a flag is the one-off override). The only fix needed is
to make the **block order** match. Align the Prisma tab to the Live database
tab's established order: prose → `npx askdb introspect` → config snippet ("For
example") → one-off override.

This is purely an editorial/ordering change. No claim changes; the flag-free
behavior was already verified in plan 022 (`apps/cli/src/introspect.ts:113` and
`:153-159`).

## Current state

`apps/docs-site/src/content/docs/quickstart.mdx`, the engine Tabs under
`## 2. Introspect your database` (verbatim at `dfd44f5`):

**Live database tab (lines 82–109) — the layout to match:**

```mdx
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
```

**Prisma schema file tab (lines 110–135) — the one to reorder:**

```mdx
  <TabItem label="Prisma schema file">

You can introspect directly from a Prisma schema file — no live database required. Point your config at the schema file under `introspection.provider` and `introspection.providerConfig`, exactly like the live-database path:

```ts
introspection: {
  provider: "prisma",
  providerConfig: {
    prisma: { schemaPath: "./prisma/schema.prisma" },
  },
},
```

Then the same one command introspects from the schema file — no flags needed:

```bash
npx askdb introspect
```

To introspect a different schema file for one run, pass the flags instead:

```bash
npx askdb introspect --engine prisma --prisma-schema ./other/schema.prisma
```

  </TabItem>
```

### Conventions to match

- Do not change the `<Tabs>` wrapper, `syncKey`, or the tab **labels**.
- Fenced blocks flush-left, blank line before/after; only `<TabItem>` tags
  indented two spaces — identical to the Live database tab in the same file.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope**: `apps/docs-site/src/content/docs/quickstart.mdx` — the "Prisma
schema file" `<TabItem>` body **only**.

**Out of scope** (do NOT touch):
- The "Live database" tab — it is the reference layout; leave it exactly as is.
- The `<Tabs>` wrapper, `syncKey`, labels, imports, the loop SVG, the
  four-command block, and every other section/page.

## Git workflow

- Branch: `advisor/023-quickstart-align-engine-tab-layout`
- Commit style: `docs(quickstart): align Prisma tab layout with live database tab`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Reorder the Prisma tab to command-first

Replace the **entire "Prisma schema file" `<TabItem>` body** (current-state
excerpt above) with the following. The substance is unchanged; only the order
flips to match the Live tab — prose, then `npx askdb introspect`, then the config
snippet as "For example", then the one-off flag override.

```mdx
  <TabItem label="Prisma schema file">

With your Prisma schema configured in `askdb.config.ts` under `introspection.provider` and `introspection.providerConfig`, one command is enough — no live database required:

```bash
npx askdb introspect
```

For example:

```ts
introspection: {
  provider: "prisma",
  providerConfig: {
    prisma: { schemaPath: "./prisma/schema.prisma" },
  },
},
```

To introspect a different schema file for one run, pass the flags instead:

```bash
npx askdb introspect --engine prisma --prisma-schema ./other/schema.prisma
```

  </TabItem>
```

**Verify**:
- `cd apps/docs-site && pnpm lint` → exit 0.
- The bare introspect command now precedes the config block in the Prisma tab.
  Within the Prisma `<TabItem>`, the line matching ```npx askdb introspect``` (the
  bare one) should come **before** the line matching `provider: "prisma"`. Check:
  `grep -n 'one command is enough — no live database required' apps/docs-site/src/content/docs/quickstart.mdx`
  reports a line **smaller** than
  `grep -n 'provider: "prisma"' apps/docs-site/src/content/docs/quickstart.mdx`.
- The old config-first phrasing is gone:
  `grep -c "Then the same one command introspects" apps/docs-site/src/content/docs/quickstart.mdx` → `0`.
- Still exactly one engine Tabs block:
  `grep -c 'syncKey="engine"' apps/docs-site/src/content/docs/quickstart.mdx` → `1`.

### Step 2: Full build + link check

`cd apps/docs-site && pnpm test` → exit 0. Confirms MDX still parses and no
links broke.

## Test plan

Docs/markup change — no unit tests. Verification is lint + build/link check.

## Done criteria

ALL must hold:

- [ ] `cd apps/docs-site && pnpm lint` exits 0 with `0 errors`
- [ ] `cd apps/docs-site && pnpm test` exits 0
- [ ] Both tabs share the same block order: prose → `npx askdb introspect` →
      config snippet ("For example") → one-off flag override
- [ ] `grep -c "Then the same one command introspects" apps/docs-site/src/content/docs/quickstart.mdx` → `0`
- [ ] `grep -c 'syncKey="engine"' apps/docs-site/src/content/docs/quickstart.mdx` → `1`
- [ ] Only `apps/docs-site/src/content/docs/quickstart.mdx` is modified (`git status`)
- [ ] `plans/README.md` status row for 023 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live file (drift since `dfd44f5`).
- `pnpm test` reports an MDX parse error you can't fix within two attempts by
  matching the Live database tab's exact fence/indentation.

## Maintenance notes

- Both engine tabs now follow the same template (command-first, config as "For
  example", flag as one-off override). Any future engine tab under
  `syncKey="engine"` should follow the same order so the group stays consistent.
