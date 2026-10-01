# AGENTS.md

Instructions for coding agents working in this repository (contributing to AskDB itself). If you're an agent implementing AskDB *into a different project*, use the docs site's own `AGENTS.md` at `/AGENTS.md` on askdb.tools instead — this file is about developing AskDB.

## Stack

pnpm workspace + Turborepo, TypeScript. Node 22.13+ to develop (pnpm 11's own floor); published packages support `>=22.12`.

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

## Agent skills

### Issue tracker

GitHub Issues on `Ygilany/AskDB`, via `gh`. Unimplemented plans (label `plan`), specs and doc/behavior discrepancies (label `discrepancy`) live there, not as new files in the repo. See `docs/agents/issue-tracker.md`.

### Project board

Priorities and release scope live on GitHub Project #27. Read `docs/agents/project-board.md` before choosing your next item, when you find work outside your current item, and when you need a maintainer decision.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), with label strings matching the role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `CONTEXT.md` (created lazily) plus ADRs in `docs/adrs/`. See `docs/agents/domain.md`.

## Where product/architecture decisions live

`docs/` is the constitution — check it before assuming behavior, not just the code:

- `docs/mission.md` — north star, principles, non-goals
- `docs/architecture.md` — package boundaries, install profiles
- `docs/contracts/` — formal contracts (modes, sensitive fields, schema format)
- `docs/adrs/` — architecture decision records

`apps/docs-site/src/content/docs/` is the public-facing docs (askdb.tools) — treat it as a product surface, not just documentation. If you change a package's public API or add a new integration pattern, the docs site needs a corresponding update or agents integrating AskDB elsewhere will get stale guidance.

## Conventions

- AskDB returns SQL; it never executes it. Any code path that runs generated SQL against a real database belongs in a host app or a fixture/test harness, not in `packages/core`.
- `@askdb/ai-*` adapters and raw Vercel AI SDK `LanguageModel` objects are both first-party, equally supported ways to give `ask()` a model — don't privilege one over the other in new docs or examples without a reason tied to who owns provider config.
- Provider adapters declare `ai` and `@askdb/ai` as peer dependencies — don't hard-pin AI SDK versions inside adapters; let the host app's `package.json` pin them.
- Add tests for behavior that affects public APIs, package output, SQL safety/validation, or user-facing workflows. Integration tests that need a live database run when their env var is set. Tests that need a real schema in every engine use the multi-engine fixture (`pnpm fixture:up`, `ASKDB_FIXTURE_HOST`; see `CONTRIBUTING.md`).
- Add a changeset (`pnpm changeset`) for any change to a publishable package. AskDB is pre-1.0 — breaking public API changes normally use a minor changeset unless the project is intentionally moving a package to 1.0.
- Keep `apps/docs-site` accurate as you go, not as a follow-up: don't invent package names, APIs, or file paths there — verify against the actual source or existing docs content before writing a claim.
- Markdown and MDX (docs, ADRs, skills, changesets, READMEs): one line per paragraph or list item, left for the editor to soft-wrap. Break lines only where the Markdown structure needs it — headings, list items, table rows, code blocks.
- When opening an issue or PR, include a metadata section at the bottom with the originating thread ID and its worktree. Format: `Thread ID: <thread-uuid> (worktree <worktree-name>)`, e.g. `Thread ID: 743d36c3-aac8-423a-b74c-62e1bbc9fa00 (worktree t3code-a0ad9d56)`. The worktree directory name is not the thread ID; look the UUID up as described in `docs/agents/project-board.md` (**Thread lines**). This provides traceability back to the conversation that initiated the work and helps retrieve context later. A thread that picks up an existing issue adds `Worked on by: <thread-uuid> (worktree <worktree-name>)` below that footer.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
