# Plan 021: Document that Studio's port and host are configurable (config + CLI flags)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4b80530..HEAD -- apps/docs-site/src/content/docs/studio.mdx apps/docs-site/src/content/docs/reference/cli.mdx apps/studio/src/cli.ts`
> If any in-scope doc changed since this plan was written, compare its "Current
> state" excerpt against the live file before editing; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. Soft-overlaps 019 on `reference/cli.mdx` (different lines)
  — if both run, apply 019 first or re-locate by `grep` (see STOP conditions).
- **Category**: docs
- **Planned at**: commit `4b80530`, 2026-06-14

## Why this matters

Studio's listen port/host are **already fully configurable** — verified in code at
`4b80530`:
- Config: `studio.listen.port` and `studio.listen.host` in `askdb.config.ts`
  (`packages/config/src/types.ts:333-334`).
- CLI flags: `--port`, `--host`, `--schema` (`apps/studio/src/cli.ts:85-99`), and
  the `askdb studio` wrapper forwards them (`apps/cli/src/cli.ts:55-57`,
  `runStudioCommand(process.argv.slice(3))`).
- Precedence in `parseOptions`: CLI flag → `studio.listen.*` config → default
  (port `5556`, host `127.0.0.1`).

**No code change is needed.** The gap is purely documentation: the Studio page
only states the default port and never says you can change it, and the CLI
reference omits the `--host` flag (which exists). This plan surfaces the existing
capability through the config field and the flags — without naming the internal
`ASKDB_STUDIO_PORT` / `ASKDB_STUDIO_HOST` env projection (consistent with plan
019's policy).

## Current state

- `apps/docs-site/src/content/docs/studio.mdx` — line 14:
  ```mdx
  Studio reads `outputDir` from `askdb.config.ts`. Pass `--schema <path>` to override for a single run. By default it serves on `http://127.0.0.1:5556`.
  ```
  No mention of changing the port/host.

- `apps/docs-site/src/content/docs/reference/cli.mdx` — the `### askdb studio`
  flag table (lines 85–88):
  ```mdx
  | Flag | Description |
  | --- | --- |
  | `--schema <path>` | Path to the schema artifact. |
  | `--port <n>` | Override the default port (5556). |
  ```
  The `--host` flag is missing.

- **Convention**: the config field path style used elsewhere on the site is
  inline code like `studio.listen.port` (e.g. `concepts/modes-and-dialects.mdx`
  uses `modes.askdbMode`). Match it.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `cd apps/docs-site && pnpm lint` | exit 0, `0 errors` |
| Build + link check | `cd apps/docs-site && pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/docs-site/src/content/docs/studio.mdx`
- `apps/docs-site/src/content/docs/reference/cli.mdx`

**Out of scope** (do NOT touch):
- `apps/studio/**`, `packages/config/**` — capability already exists; this is
  docs only.
- The `ASKDB_STUDIO_PORT` / `ASKDB_STUDIO_HOST` env names — do not introduce them
  into the docs (plan 019's policy).
- 019's `cli.mdx` edits (the `ASKDB_INTROSPECT_OUT` / `ASKDB_LOG_LEVEL` rows are a
  different region — leave them to 019).

## Git workflow

- Branch: `advisor/021-document-studio-port-host`
- Commit style: conventional, e.g. `docs(studio): document configurable port and host`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Note port/host configurability on the Studio page

In `studio.mdx`, replace the line 14 sentence with:

```mdx
Studio reads `outputDir` from `askdb.config.ts`. Pass `--schema <path>` to override for a single run. By default it serves on `http://127.0.0.1:5556` — change that with the `--port` and `--host` flags, or set `studio.listen.port` and `studio.listen.host` in `askdb.config.ts` (a CLI flag overrides the config for that run).
```

**Verify**: `grep -c "studio.listen.port" apps/docs-site/src/content/docs/studio.mdx` → `1`. Then `cd apps/docs-site && pnpm lint` → exit 0.

### Step 2: Add the `--host` flag to the CLI reference

In `reference/cli.mdx`, in the `### askdb studio` flag table, add a `--host` row
after the `--port` row, and mention the config equivalents:

```mdx
| `--schema <path>` | Path to the schema artifact. |
| `--port <n>` | Override the listen port (default `5556`; or set `studio.listen.port` in config). |
| `--host <host>` | Override the bind host (default `127.0.0.1`; or set `studio.listen.host` in config). |
```

**Verify**: `grep -c "\-\-host <host>" apps/docs-site/src/content/docs/reference/cli.mdx` → `1`. Then `cd apps/docs-site && pnpm lint` → exit 0.

## Test plan

Docs change — no unit tests. Gate is the build + link check:

- `cd apps/docs-site && pnpm test` → exit 0.

## Done criteria

ALL must hold:

- [ ] `studio.mdx` documents changing port/host via flags and `studio.listen.*`
- [ ] `cli.mdx`'s `askdb studio` table includes a `--host <host>` row and points
      `--port`/`--host` at their `studio.listen.*` config equivalents
- [ ] Neither file mentions `ASKDB_STUDIO_PORT` / `ASKDB_STUDIO_HOST`
- [ ] `cd apps/docs-site && pnpm lint` exits 0; `pnpm test` exits 0
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 021 updated

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since `4b80530`)
  — if 019 already restructured the `cli.mdx` studio region, re-locate the
  `askdb studio` table by `grep` and add the `--host` row there.
- The code capability no longer matches the claim (e.g. `apps/studio/src/cli.ts`
  no longer parses `--host`/`--port`, or `studio.listen` was removed from the
  config type) — in that case the docs would be wrong; STOP and report, because
  it becomes a code task, not a docs task.

## Maintenance notes

- This documents existing behavior; if the Studio CLI's default port (`5556`) or
  the `studio.listen` config shape changes, update both pages.
- The Studio CLI's own `--help` text (`apps/studio/src/cli.ts`) still references
  `ASKDB_STUDIO_PORT`, `ASKDB_AI_MODEL`, etc. Bringing that help text in line with
  plan 019's "no internal env names" policy is a separate, optional code cleanup —
  noted here so it isn't forgotten, but deliberately out of this docs plan's scope.
