# AGENTS.md

Instructions for coding agents working in this repository (contributing to AskDB itself). If you're an agent implementing AskDB *into a different project*, use the docs site's own `AGENTS.md` at `/AGENTS.md` on askdb.tools instead — this file is about developing AskDB.

## Stack

pnpm workspace + Turborepo, TypeScript. Node 20+.

- `packages/core` — the NL-to-SQL pipeline (`ask()`), schema artifact loader.
- `packages/ai`, `packages/ai-*` — AI provider registry and adapters (openai/anthropic/google/azure).
- `packages/client` — config-driven facade (`createAskDb`) over `@askdb/core` + `@askdb/ai`.
- `packages/introspect`, `packages/postgres`, `packages/mysql`, `packages/sqlite`, `packages/sqlserver` — introspection + dialects.
- `packages/rag` — schema chunking/indexing/retrieval.
- `packages/enrich` — schema-authoring helpers used by Studio.
- `apps/cli` — the `askdb` binary.
- `apps/http-api` — HTTP wrapper over core.
- `apps/studio` — browser UI for schema enrichment.
- `apps/docs-site` — Starlight docs site (askdb.tools).

## Commands

```bash
pnpm install
pnpm build           # turbo run build
pnpm test            # turbo run test — integration tests run when DATABASE_URL is set
pnpm lint            # turbo run lint — TypeScript noEmit
pnpm docs:dev         # docs site at 127.0.0.1:4310
pnpm docs:build
```

Before opening or updating a PR, run the release-style checks:

```bash
pnpm smoke:install
pnpm preflight
```

## Before a PR leaves draft

Open every PR as a draft. Before it is marked ready for review:

- An agent, session, or person that did not write the change reviews it with the `pr-review` skill (see "PR review" below). The implementer's own session never reviews its diff. AI reviews post from the maintainer's account, so each one opens with a disclosure line naming the model that ran it.
- Every review finding is fixed in a commit or answered in a reply on the PR.
- After every push (review fixes, test-audit commits, rebases, merges), re-check the PR title and description against the final diff: every named test, export, count, and behavior claim. When non-trivial code changes land after the review, re-run it on the new commits.

## Agent skills

### Issue tracker

GitHub Issues on `Ygilany/AskDB`, via `gh`. Unimplemented plans (label `plan`), specs and doc/behavior discrepancies (label `discrepancy`) live there, not as new files in the repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), with label strings matching the role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `CONTEXT.md` (created lazily) plus ADRs in `docs/adrs/`. See `docs/agents/domain.md`.

### PR review

The `pr-review` skill from [Ygilany/ygilany-skills](https://github.com/Ygilany/ygilany-skills) (`npx skills add https://github.com/Ygilany/ygilany-skills --skill pr-review`, available once Ygilany/ygilany-skills#1 merges). AskDB's rules, sensitive paths (which also get the built-in `/security-review`), checklists, and posting commands are in `docs/agents/pr-review.md`.

## Where product/architecture decisions live

`docs/` is the constitution — check it before assuming behavior, not just the code:

- `docs/mission.md` — north star, principles, non-goals
- `docs/architecture.md` — package boundaries, install profiles
- `docs/contracts/` — formal contracts (modes, sensitive fields, schema format)
- `docs/adrs/` — architecture decision records; `docs/adrs/README.md` indexes them in one line each. Read the index before you plan a change.

`apps/docs-site/src/content/docs/` is the public-facing docs (askdb.tools) — treat it as a product surface, not just documentation. If you change a package's public API or add a new integration pattern, the docs site needs a corresponding update or agents integrating AskDB elsewhere will get stale guidance.

## Architecture and decisions

Every change, whether you write it or review it, is checked against these three rules.

- **Right layer, clean boundary.** Put each change in the package that owns the behavior (`docs/architecture.md`, "Dependency boundaries"). Dependencies point down: core ← introspect / ai ← engine packages and optional libraries ← apps. Engine-specific code lives in its engine package; code shared by engines lives in the shared kit; app-only concerns (transport, request guards, UI) stay in the app. Fix a defect at its owner, not in the caller that hit it.
- **User-facing changes update the docs site in the same PR.** That covers a public API, CLI flag, config key, default, error text, Studio behavior, or integration pattern: update `apps/docs-site/src/content/docs/` in the same PR, not as a follow-up.
- **Record choices between clean options in an ADR.** When a change picks between two or more viable designs, add `docs/adrs/NNNN-title.md` (context, options considered, decision, consequences) and a row in `docs/adrs/README.md` in the same PR. To change an accepted decision, amend or supersede its ADR; don't just change the code. If two open PRs claim the same ADR number, the second to merge renumbers.

## Conventions

- AskDB returns SQL; it never executes it. Any code path that runs generated SQL against a real database belongs in a host app or a fixture/test harness, not in `packages/core`.
- `@askdb/ai-*` adapters and raw Vercel AI SDK `LanguageModel` objects are both first-party, equally supported ways to give `ask()` a model — don't privilege one over the other in new docs or examples without a reason tied to who owns provider config.
- Provider adapters declare `ai` and `@askdb/ai` as peer dependencies — don't hard-pin AI SDK versions inside adapters; let the host app's `package.json` pin them.
- Add tests for behavior that affects public APIs, package output, SQL safety/validation, or user-facing workflows. Integration tests that need a live database run when their env var is set. Tests that need a real schema in every engine use the multi-engine fixture (`pnpm fixture:up`, `ASKDB_FIXTURE_HOST`; see `CONTRIBUTING.md`).
- Add a changeset (`pnpm changeset`) for any change to a publishable package. AskDB is pre-1.0 — breaking public API changes normally use a minor changeset unless the project is intentionally moving a package to 1.0.
- Keep `apps/docs-site` accurate as you go, not as a follow-up: don't invent package names, APIs, or file paths there — verify against the actual source or existing docs content before writing a claim.
- Markdown and MDX (docs, ADRs, skills, changesets, READMEs): one line per paragraph or list item, left for the editor to soft-wrap. Break lines only where the Markdown structure needs it — headings, list items, table rows, code blocks.
- When opening an issue or PR, include a metadata section at the bottom with the originating thread ID. Format: `Thread ID: [id]`. This provides traceability back to the conversation that initiated the work and helps retrieve context later.
