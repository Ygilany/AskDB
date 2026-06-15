# Plan 022: Quickstart — make the Prisma introspection tab config-first (match the Live database tab)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c649d2c..HEAD -- apps/docs-site/src/content/docs/quickstart.mdx`
> If that file changed since this plan was written, compare the "Current state"
> excerpt below against the live file before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (15 already landed the Tabs; this only rewrites the Prisma tab body)
- **Category**: docs
- **Planned at**: commit `c649d2c`, 2026-06-15

## Why this matters

On the quickstart's "2. Introspect your database" step, the two engine variants
are presented as synced Tabs. They are **inconsistent in how they teach the
tool**:

- The **"Live database"** tab is *config-first*: it says "with your database
  connection configured in `askdb.config.ts` … one command is enough"
  (`npx askdb introspect`), shows the config snippet, and only then mentions a
  CLI flag (`--url`) as a *one-off override* for "a different database for one
  run."
- The **"Prisma schema file"** tab is *CLI-first*: it leads with
  `npx askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma`
  and then adds, almost as an afterthought, "You can also set this in
  `askdb.config.ts` so no flags are needed."

A reader following the quickstart configures everything in `askdb.config.ts`
(the whole of step 1 is about filling out that file), so the natural question —
the one that prompted this plan — is *"why do I have to pass `--engine` and
`--prisma-schema` on the command line when I set the live database in config?"*
The answer is **you don't**. Flag-free Prisma introspection already works; the
tab just teaches the wrong order.

**This is verified against the code, not assumed** (commit `c649d2c`):

- `apps/cli/src/introspect.ts:113` —
  `const engine = resolveEngine(opts.engine ?? rt.introspection.provider);`
  When `--engine` is omitted, the engine comes from `introspection.provider` in
  config. So `provider: "prisma"` makes `--engine prisma` unnecessary.
- `apps/cli/src/introspect.ts:153-159` — when `engine === "prisma"` and
  `--prisma-schema` is not passed, it falls back to
  `rt.introspection.prismaSchemaPath` (and if that is also unset, `@askdb/prisma`
  auto-discovers `prisma/schema.prisma`). So
  `providerConfig.prisma.schemaPath` makes `--prisma-schema` unnecessary.
- `packages/config/src/runtime-config.ts:144-146,182` — `prismaSchemaPath` is
  resolved from `introspection.providerConfig.prisma.schemaPath`.

So with this in `askdb.config.ts`:

```ts
introspection: {
  provider: "prisma",
  providerConfig: {
    prisma: { schemaPath: "./prisma/schema.prisma" },
  },
},
```

…a bare `npx askdb introspect` introspects from the Prisma schema with no flags
at all — exactly parallel to the live-database path. The fix is to flip the tab
to config-first so the two tabs teach the same mental model.

## Current state

`apps/docs-site/src/content/docs/quickstart.mdx` — the "Prisma schema file"
`<TabItem>` under `## 2. Introspect your database`. Current body (verbatim,
lines 110–129 at `c649d2c`):

```mdx
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
```

For reference, the **"Live database"** tab it should mirror (lines 82–108) leads
with the config-driven `npx askdb introspect`, shows the Postgres config
snippet, then presents `--url` as the one-off override with the sentence: *"The
database is only used here — for introspection. To target a different database
for one run, pass `--url`:"*. Match that structure and tone.

### Conventions to match

- The `<Tabs syncKey="engine">` block already exists (added by plan 015). **Do
  not** change the `<Tabs>`/`<TabItem>` tags, the `syncKey`, or the tab
  **labels** ("Live database", "Prisma schema file") — the `engine` syncKey is
  shared with `guides/switch-engines.mdx`, and changing labels here would not
  desync those (different label sets already), but it is out of scope regardless.
- Fenced code blocks inside a `<TabItem>` are flush-left with a blank line
  before and after; only the `<TabItem>` tags are indented two spaces. This
  matches the existing Live-database tab in the same file — copy its exact
  spacing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope** (only this file, only the one tab body):
- `apps/docs-site/src/content/docs/quickstart.mdx` — the "Prisma schema file"
  `<TabItem>` body only.

**Out of scope** (do NOT touch):
- The "Live database" tab — it is already config-first and correct.
- The `<Tabs>` wrapper, `syncKey`, tab labels, or the imports.
- The loop SVG, the four-command block (lines 22–27), and every other section.
- `guides/switch-engines.mdx` or any other page (the Prisma flags may be taught
  there too, but this plan is scoped to the quickstart).

## Git workflow

- Branch: `advisor/022-quickstart-prisma-tab-config-first`
- Commit style: conventional, e.g.
  `docs(quickstart): make Prisma introspection tab config-first`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite the Prisma tab body to be config-first

Replace the **entire "Prisma schema file" `<TabItem>` body** (the current state
excerpt above) with the following. The change: lead with the config snippet +
flag-free `npx askdb introspect`, then demote the flags to a one-off override,
mirroring the Live-database tab's `--url` framing.

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

**Why this exact wording**: it parallels the Live-database tab sentence-for-
sentence — config snippet → flag-free `npx askdb introspect` → "for one run,
pass the flag." The `--engine prisma --prisma-schema` form is kept (it is real
and useful for a one-off), just repositioned as the override rather than the
headline. The example one-off path is `./other/schema.prisma` so it visibly
differs from the configured `./prisma/schema.prisma`, the same way the live tab
uses `$OTHER_DATABASE_URL`.

**Verify**:
- `cd apps/docs-site && pnpm lint` → exit 0.
- The flag form is no longer the first command in the tab. Confirm the config
  block now precedes the bare-introspect command:
  `grep -n 'provider: "prisma"' apps/docs-site/src/content/docs/quickstart.mdx`
  should report a line number **smaller** than the line reported by
  `grep -n 'npx askdb introspect --engine prisma' apps/docs-site/src/content/docs/quickstart.mdx`.
- The "You can also set this in `askdb.config.ts`" afterthought sentence is gone:
  `grep -c "You can also set this in" apps/docs-site/src/content/docs/quickstart.mdx` → `0`.
- Still exactly one engine Tabs block (unchanged):
  `grep -c 'syncKey="engine"' apps/docs-site/src/content/docs/quickstart.mdx` → `1`.

### Step 2: Full build + link check

Run `cd apps/docs-site && pnpm test` → exit 0. This confirms the MDX still
parses (the Tabs/TabItem nesting and fence indentation are valid) and no
internal links broke.

## Test plan

Docs/markup change — no unit tests. Verification is lint + the build/link check
in the Commands table. There is no executable assertion of the CLI behavior in
this plan because the behavior already exists and is covered by
`apps/cli/src/introspect-shim.test.ts` (see lines 95–127, which exercise the
`providerConfig.prisma.schemaPath` config path). Do **not** add CLI tests here.

## Done criteria

ALL must hold:

- [ ] `cd apps/docs-site && pnpm lint` exits 0 with `0 errors`
- [ ] `cd apps/docs-site && pnpm test` exits 0
- [ ] In the "Prisma schema file" tab, the `provider: "prisma"` config block
      appears **before** the bare `npx askdb introspect` command, which appears
      **before** the `--engine prisma --prisma-schema` flag command
- [ ] `grep -c "You can also set this in" apps/docs-site/src/content/docs/quickstart.mdx` → `0`
- [ ] `grep -c 'syncKey="engine"' apps/docs-site/src/content/docs/quickstart.mdx` → `1`
- [ ] Only `apps/docs-site/src/content/docs/quickstart.mdx` is modified (`git status`)
- [ ] `plans/README.md` status row for 022 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpt does not match the live file (drift since
  `c649d2c`) — in particular if the Prisma tab no longer exists or has already
  been made config-first by another change.
- `pnpm test` reports an MDX parse error on the tab you cannot resolve within two
  attempts by matching the Live-database tab's exact fence/indentation.
- You discover the CLI no longer falls back to config for `--engine`/
  `--prisma-schema` (i.e. `apps/cli/src/introspect.ts:113` or `:153-159` have
  changed such that flag-free Prisma introspection would fail) — the doc would
  then be wrong, so report instead of shipping it.

## Maintenance notes

- This makes both engine tabs teach the same order: config first, CLI flag as a
  one-off override. If a future engine tab is added under the same
  `syncKey="engine"`, follow this config-first structure for consistency.
- The claim "no flags needed" depends on the CLI fallbacks at
  `apps/cli/src/introspect.ts:113` (engine ← `introspection.provider`) and
  `:153-159` (prisma schema ← `introspection.providerConfig.prisma.schemaPath`).
  If either fallback is ever removed, this tab must revert to the flag form — add
  it to that code's review checklist.
- `guides/switch-engines.mdx` also documents engine selection; if it teaches the
  Prisma flags CLI-first, consider aligning it in a follow-up (out of scope here).
