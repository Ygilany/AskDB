# AskDB docs house style

Project preferences for the AskDB docs site (askdb.tools). Agents writing docs with a
Diátaxis workflow read this as the house style; anything here overrides the workflow's
defaults.

## Readers

In priority order (from `docs/mission.md`):

1. **Builders and integrators** — engineers embedding AskDB in a Node app, CLI workflow, or
   HTTP service. They own schema supply, API keys, execution, modes, and tenant rules.
2. **Agents** — coding assistants implementing AskDB in another project. They read the site
   and `public/AGENTS.md` (served at `/AGENTS.md`) and need stable, exact APIs.
3. **Askers** — analysts using an app that already integrated AskDB. The site rarely
   addresses them directly; Studio pages come closest.

## Voice

- Second person ("you"); "we" only inside tutorials, as the teacher alongside the learner.
- Short, direct sentences. US spelling. Sentence-case headings.
- No emoji. Contractions are fine.

## Terminology

| Use | Instead of | Notes |
|---|---|---|
| schema artifact | describable schema | |
| reviewed schema context | describable context | |
| natural-language analytics | NL-to-SQL | In introductory sections; "NL-to-SQL" is fine in reference. |
| AskDB returns SQL | execution boundary | In beginner-facing sections. |
| your application owns execution | host owns execution | |
| large schemas | RAG | Until the concept is introduced. |

Introduce these only after the reader understands the product — fine in concept and
reference pages, too early on Start pages and the first guides: Schema v2, RAG, BYO
runtime, MCP, bounded results, headless contracts, dialect-agnostic, optional peers,
runtime snapshot.

Model wiring has two first-party paths — `@askdb/ai-*` adapters and a raw Vercel AI SDK
`LanguageModel` passed to `ask()`. Present both as equally supported; choose between them
by who owns provider config.

## Site structure

| Sidebar section | Diátaxis type | Folder |
|---|---|---|
| Start | Tutorial (Quickstart), plus orientation (Overview, Install, Studio) | root |
| Guides | How-to guides | `guides/`, `guides/integrations/` |
| Concepts | Explanation | `concepts/` |
| Reference | Reference | `reference/` |

The sidebar is hand-written in `astro.config.mjs`; every new page needs an entry there.
Pages open with `<p class="doc-eyebrow">` and `<p class="doc-lede">` and end with a
"Read next" section linking the natural next pages.

The `starlight-llms-txt` `details` string in `astro.config.mjs` summarises the site
structure for LLMs — update it when sections change.

## Tooling

- Docs tool: Astro Starlight
- Content root: `apps/docs-site/src/content/docs/`
- Navigation file: `apps/docs-site/astro.config.mjs` (`sidebar`)
- Dev server: `pnpm docs:dev` (127.0.0.1:4310)
- Build / check: `pnpm docs:build`; `pnpm -C apps/docs-site test` (build + internal link check); `pnpm -C apps/docs-site lint` (`astro check`)
- Internal links: root-absolute (`/guides/embed-in-node/`); a remark plugin rebases them.

## Components

- `InstallTabs` (`<InstallTabs pkgs="…" />`) for every package install.
- `Tabs` with a `syncKey` so choices persist site-wide: `pkg` (labels exactly npm / pnpm /
  yarn), `engine` (database engines), `wiring` (adapter vs raw model).
- `Aside` for prerequisites and real hazards — `note`, `tip`, `caution`; keep them rare.
- `ExampleLink` to point at a runnable example in the repo.
- Diagrams live in `src/assets/diagrams/` as SVG.

## Code samples

- TypeScript for library code; bash for commands. Standalone command snippets use `npx`
  (readers substitute `pnpm dlx` / `yarn dlx`); multi-command flows use `pkg` tabs.
- Samples show AskDB returning SQL; any execution runs through the reader's own connection
  (`pg`, Prisma, …), never through AskDB.
- Placeholders: environment variables (`process.env.OPENAI_API_KEY`) rather than inline
  fake keys.

## Sources of truth

- Verify every API, option, default, flag, config key, route, and path against source in
  `packages/*` and `apps/*` before writing it. Never invent package names, APIs, or paths.
- Behaviour contracts: `docs/contracts/`; decisions: `docs/adrs/`; package boundaries:
  `docs/architecture.md`; product intent: `docs/mission.md`.
- The docs must never claim AskDB executes SQL, owns credentials, or trains on customer data.

## Process

- A public API change or new integration pattern ships with its docs update in the same PR.
- Docs vs behaviour discrepancies found while writing go to GitHub Issues with the
  `discrepancy` label (see `docs/agents/issue-tracker.md`); audits and multi-step docs plans
  go there with `plan` + `documentation`.
- Add a changeset for `@askdb/docs-site` (patch) with docs changes, like any package.
- New pages and restructures: propose the outline first. Edits to existing pages: proceed.
