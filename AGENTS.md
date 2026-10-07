# AGENTS.md

Instructions for coding agents working in this repository (contributing to AskDB itself). If you're an agent implementing AskDB *into a different project*, use the docs site's own `AGENTS.md` at `/AGENTS.md` on askdb.tools instead — this file is about developing AskDB.

## Stack

pnpm workspace + Turborepo, TypeScript. Node 22.14+ to develop; published packages support `>=22.14` (better-sqlite3 13 segfaults on earlier 22.x, #419).

- `packages/core` — the NL-to-SQL pipeline (`ask()`), schema artifact loader.
- `packages/ai` — AI provider registry and the built-in providers (openai/anthropic/google/azure/gateway), one file each under `packages/ai/src/providers/`. `packages/ai-*` are deprecated re-export shims; don't add code there.
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
pnpm lint            # check-test-gating, then turbo run lint — TypeScript noEmit
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

### Code review

Every PR needs an independent review before it leaves draft, and always when an agent authored it. Review with a fresh agent using the `code-review` skill, which follows this repo's review profile. See `docs/agents/code-review.md`.

### Docs house style

Docs follow the house style in `apps/docs-site/STYLE.md`. Its Terminology line naming the `@askdb/ai-*` adapters as a first-party path is stale (#456); follow the Conventions above there.

## Where product/architecture decisions live

`docs/` is the constitution — check it before assuming behavior, not just the code:

- `docs/mission.md` — north star, principles, non-goals
- `docs/architecture.md` — package boundaries, install profiles
- `docs/contracts/` — formal contracts (modes, sensitive fields, schema format)
- `docs/adrs/` — architecture decision records; `docs/adrs/README.md` indexes them in one line each. Read the index before you plan a change.

`apps/docs-site/src/content/docs/` is the public-facing docs (askdb.tools) — treat it as a product surface, not just documentation. If you change a package's public API or add a new integration pattern, the docs site needs a corresponding update or agents integrating AskDB elsewhere will get stale guidance.

## Architecture and decisions

Every change, whether you write it or review it, is checked against these three rules.

- **Right layer, clean boundary.** Put each change in the package that owns the behavior, with imports pointing down the layers in `docs/architecture.md` ("Dependency boundaries"). Engine-specific code lives in its engine package, apart from the built-in `DialectSpec`s and dialect-keyed lexing and quoting, which stay in `@askdb/core` (ADR 0002); app-only concerns (transport, request guards, UI) stay in the app. Fix a defect at its owner, not in the caller that hit it.
- **User-facing changes update the docs site in the same PR.** That covers a public API, CLI flag, config key, default, error text, Studio behavior, or integration pattern: update `apps/docs-site/src/content/docs/` in the same PR, not as a follow-up.
- **Record choices between clean options in an ADR.** When a change picks between two or more viable designs, add `docs/adrs/NNNN-title.md` (status, context, decision, alternatives, consequences) and a row in `docs/adrs/README.md` in the same PR. To change an accepted decision, amend or supersede its ADR; don't just change the code.

## Conventions

- AskDB returns SQL; it never executes it. Any code path that runs generated SQL against a real database belongs in a host app or a fixture/test harness, not in `packages/core`.
- `@askdb/ai`'s built-in providers (`createAiRegistry()`, `createAskDb({ config })`) and raw Vercel AI SDK `LanguageModel` objects are both first-party, equally supported ways to give `ask()` a model — don't privilege one over the other in new docs or examples without a reason tied to who owns provider config. Don't point new docs or examples at the deprecated `@askdb/ai-*` shims.
- `@askdb/ai` declares `ai` as a peer and each `@ai-sdk/*` provider SDK as an optional peer with a wide floor (the oldest version its contract tests pass against; `pnpm test:ai-floors` checks it in CI) — don't hard-pin AI SDK versions in library packages; let the host app's `package.json` pin them. Built-in providers import their SDK lazily with the `.catch()` chained on the `import()` so esbuild doesn't require every SDK; webpack still does unless the host lists the missing ones in `externals` (see `packages/ai/src/providers/optional-peer.ts`).
- Published ranges are what hosts install against, so a bump the range already allows moves only the lockfile. A floor rises by hand, for a security fix or a version AskDB needs, with a changeset naming which; raising an `ai` or `@ai-sdk/openai` floor raises the consumer lab's host pin with it, or its `host-peers` scenario fails (ADR 0015).
- Add tests for behavior that affects public APIs, package output, SQL safety/validation, or user-facing workflows. Integration tests that need a live database run when their env var is set. Tests that need a real schema in every engine use the multi-engine fixture (`pnpm fixture:up`, `ASKDB_FIXTURE_HOST`; see `CONTRIBUTING.md`).
- Add a changeset (`pnpm changeset`) for any change to a publishable package. AskDB is pre-1.0 — breaking public API changes normally use a minor changeset unless the project is intentionally moving a package to 1.0.
- A change that doesn't alter what a package ships to users (code comments, tests) bumps no version. When the Changesets status check still requires an entry because a file under `src/` changed, add an empty one (`pnpm changeset --empty`) instead of a patch bump. Docs-site edits are the exception: they take a patch changeset for `@askdb/docs-site` (`apps/docs-site/STYLE.md`).
- Keep `apps/docs-site` accurate as you go, not as a follow-up: don't invent package names, APIs, or file paths there — verify against the actual source or existing docs content before writing a claim.
- Markdown and MDX (docs, ADRs, skills, changesets, READMEs): one line per paragraph or list item, left for the editor to soft-wrap. Break lines only where the Markdown structure needs it — headings, list items, table rows, code blocks.
- When opening an issue or PR, include a metadata section at the bottom with the originating thread ID and its worktree. Format: `Thread ID: <thread-uuid> (worktree <worktree-name>)`, e.g. `Thread ID: 743d36c3-aac8-423a-b74c-62e1bbc9fa00 (worktree t3code-a0ad9d56)`. The worktree directory name is not the thread ID; look the UUID up as described in `docs/agents/project-board.md` (**Thread lines**). This provides traceability back to the conversation that initiated the work and helps retrieve context later. A thread that picks up an existing issue adds `Worked on by: <thread-uuid> (worktree <worktree-name>)` below that footer.

## Reporting to the maintainer

The maintainer reads your end-of-turn reply top-down and wants the reasoning kept in it, so make it scannable, in this order:

1. **Answer**: the outcome or your recommendation, in one or two lines.
2. **Status table**: one row per PR, issue or check, when the turn touched several.
3. **Needs you**: only the decisions that are the maintainer's to make.
4. **Why**: the reasoning, under one short `###` heading per topic, a few bullets each, every bullet led by a bold phrase.

State each point once, in the section it belongs to. Give verification as one line of results; the details go in the PR or issue body.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
