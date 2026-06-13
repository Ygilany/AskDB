# Plan 013: Design spike — Studio as the front door (guided setup + "get the code")

> **Executor instructions**: This is a **design spike**, not a build plan.
> The deliverable is a written spec with decisions and open questions — you
> investigate the codebase and produce a document; you do not modify any
> application source. Follow the steps, run the verification commands, and if
> anything in "STOP conditions" occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat bd751df..HEAD -- apps/studio/src apps/cli/src packages/config/src`
> If these moved substantially since `bd751df`, re-verify every "Current
> state" fact you cite in the spec against the live code.

## Status

- **Priority**: P3
- **Effort**: M (for the spike; the implementation it specifies is L and gets its own plans)
- **Risk**: LOW (no code changes)
- **Depends on**: none (informed by plans 009–012 but independent)
- **Category**: direction
- **Planned at**: commit `bd751df`, 2026-06-12

## Why this matters

Today the onboarding path is CLI-first: `init` → edit config → `introspect`
→ then Studio becomes useful. The product owner wants to evaluate inverting
this: **`npx askdb studio` as the single first command**, where Studio
detects a missing config/artifact and walks the user through setup in the
browser, and where Studio's playground emits ready-to-paste integration code
once questions work. This would collapse onboarding to one command and bridge
the "works in Studio" → "works in my app" gap. It is grounded in intent
already visible in the code (see evidence below), but it changes Studio's
responsibilities (writing config, running introspection, handling secrets in
a browser UI), so it needs a design pass before any build plan exists.

## Current state (verified evidence — cite these in the spec)

- **Studio requires an existing artifact and errors out otherwise**:
  `apps/studio/src/cli.ts` resolves `--schema` from
  `introspection.outputDir` (line ~77) and exits with a formatted error when
  the workspace can't load (lines 41–50). There is no setup path.
- **An introspect-from-Studio affordance exists but is dead**:
  `apps/studio/src/web/views/overview/OverviewPage.tsx:40` renders a
  "Resync schema" button whose handler is `onClick={() => void 0}` — a
  no-op. The intent (refresh the artifact from the database without leaving
  Studio) is designed into the UI but unbuilt.
- **Studio already knows everything an integration snippet needs**: the
  workspace context exposes `aiProvider` and `schemaId`
  (`OverviewPage.tsx:35`: `{workspace.aiProvider || "postgres"} · {workspace.schemaId}`);
  the playground (`apps/studio/src/web/views/playground/PlaygroundPage.tsx`,
  585 lines) holds the question, generated SQL, tenant scope, and output
  mode. The embed snippet the docs hand-maintain
  (`apps/docs-site/src/content/docs/index.mdx:47-64`,
  `guides/embed-in-node.mdx:36-66`) is a pure function of those values plus
  the dialect.
- **Config writing is currently CLI-only**: `apps/cli/src/init.ts` scaffolds
  `askdb.config.ts`; `@askdb/config`'s `bootstrapAskDbEnv()` reads it from
  the process CWD (`packages/config`, documented in
  `apps/docs-site/src/content/docs/reference/config.mdx:51-58`).
- **Security posture today**: Studio binds `127.0.0.1:5556` by default
  (`apps/studio/README.md`); it already writes files (the enrichment
  markdown layer) but never writes config or touches credentials beyond
  reading env.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Run Studio against fixture | `ASKDB_MOCK_SQL=1 pnpm --filter @askdb/studio start -- --schema ./fixtures/schemas/orders-users.schema` | serves on `127.0.0.1:5556` |
| Lint the spec's home repo state | `git status --porcelain` | only the new spec files |

## Scope

**In scope** (the only files you create/modify):
- `docs/specs/studio-first-onboarding/README.md` (create — the spec)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any source under `apps/`, `packages/`.
- The docs site.
- Do not create implementation plans for the build — the maintainer decides
  scope after reading the spec.

## Git workflow

- Branch: `advisor/013-studio-first-onboarding-spike`
- One commit, e.g. `docs(specs): studio-first onboarding design spike`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Experience the current cold-start failure firsthand

From an empty temp directory (e.g. `mktemp -d`), run the built studio binary
with no config and no artifact and record the exact error output. Then run it
from the repo root against the fixture (command above) and click through all
seven views. Write down: what a brand-new user sees at each failure point,
and what the Overview "Resync schema" button does (nothing).

**Verify**: your notes contain the verbatim cold-start error message.

### Step 2: Write the spec

Create `docs/specs/studio-first-onboarding/README.md` following the structure
of the existing spec hubs (see `docs/specs/phase-6-introspection/README.md`
for the house style: problem, goals/non-goals, requirements, open questions,
merge bar). The spec must cover, with a recommendation for each:

1. **Guided setup flow** — when Studio starts with no config and/or no
   artifact: a browser wizard that (a) writes `askdb.config.ts` (provider
   choice, env-var names — never values), (b) prompts the user to put keys
   in `.env` themselves, (c) runs introspection server-side and opens the
   Overview. Decide: does Studio shell out to the CLI, or call
   `@askdb/introspect` programmatically? (Note the CLI already depends on
   the same packages; recommend the programmatic path only if it avoids
   duplicated config resolution.)
2. **Fixing "Resync schema"** — the smallest standalone slice; specify the
   endpoint, its relationship to `introspection.providerConfig`, and how
   enrichment preservation on re-introspect (already a product guarantee,
   `guides/author-your-schema.mdx:45-53`) is surfaced in the UI.
3. **"Get the code" in the playground** — a panel that renders the exact
   `ask()` integration snippet for the current workspace: dialect from the
   artifact, provider from config (both wiring styles — direct AI SDK model
   and config-driven `createAiRegistry`/`createLanguageModelFromEnv` from
   `@askdb/ai`), schema path, and the user's current question as the example.
   Include copy-to-clipboard and a link to the docs embed guide. Specify the
   template inputs precisely so snippets never drift from the docs (consider:
   should the docs-site and Studio share snippet templates? state a position).
4. **Security boundaries** — config/file writes stay behind the localhost
   bind; the wizard never accepts secret values into config (env-var names
   only); what happens if someone exposes the port.
5. **CLI parity & docs impact** — the CLI flow remains first-class (SSH/CI);
   which docs pages change if this ships (quickstart fast path becomes
   `init`-optional; Studio tour page gains the wizard).
6. **Open questions** — at minimum: where introspection credentials for the
   wizard come from on first run (no `.env` exists yet); whether the wizard
   writes `.env.example`; sequencing relative to the announcement.
7. **Coarse estimates** — per slice (wizard, resync, get-the-code), S/M/L
   with one-line justification. Call out "get the code" and "resync" as
   independently shippable before the full wizard.

Every factual claim about current behavior must cite a `file:line` from
"Current state" or from your own step-1 observations.

**Verify**: `test -f docs/specs/studio-first-onboarding/README.md && grep -c "Open questions" docs/specs/studio-first-onboarding/README.md` → ≥ 1.

### Step 3: Cross-check the spec against the registry API

Confirm the `@askdb/ai` snippet in the spec's "get the code" section
compiles conceptually against `packages/ai/src/provider.ts` (exports
`createAiRegistry`, registry method `createLanguageModelFromEnv(env)`
returning `Promise<LanguageModel | undefined>`). Quote the actual signatures
in the spec.

**Verify**: `grep -n "createLanguageModelFromEnv" docs/specs/studio-first-onboarding/README.md` → at least one match.

## Test plan

Not applicable (document deliverable). The verification gates are the grep
checks above plus `git status --porcelain` showing only the new spec and the
plans index row.

## Done criteria

- [ ] `docs/specs/studio-first-onboarding/README.md` exists and covers all
      seven numbered topics from step 2 (each as a section)
- [ ] Cold-start error message from step 1 is quoted in the spec
- [ ] Every "current behavior" claim has a `file:line` citation
- [ ] `git status --porcelain` shows only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Resync schema" no-op has been wired up since `bd751df` (someone built
  part of this) — re-scope the spec around what exists before writing.
- Studio fails to start against the fixture (broken build) — report; do not
  debug the app.
- You find an existing spec or ADR already covering studio-first onboarding
  (search `docs/specs` and `docs/adrs` first) — reconcile instead of
  duplicating.

## Maintenance notes

- The spec is an input to the maintainer's announcement-sequencing decision;
  it should not be treated as approved scope.
- If accepted, "fix Resync schema" and "get the code" are the natural first
  build plans (each independently shippable); the wizard is the long pole.
- The docs plans (009–012) intentionally document the *current* CLI-first
  flow; if this spike ships as product work, quickstart and the Studio tour
  page need a follow-up pass.
