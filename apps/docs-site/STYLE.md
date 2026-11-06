# AskDB docs house style

Project preferences for the AskDB docs site (askdb.tools). Agents writing docs with a Diátaxis workflow read this as the house style; anything here overrides the workflow's defaults.

## Readers

In priority order (from `docs/mission.md`):

1. **Builders and integrators** — engineers embedding AskDB in a Node app, CLI workflow, or HTTP service. They own schema supply, API keys, execution, modes, and tenant rules.
2. **Agents** — coding assistants implementing AskDB in another project. They read the site and `public/AGENTS.md` (served at `/AGENTS.md`) and need stable, exact APIs.
3. **Askers** — analysts using an app that already integrated AskDB. The site rarely addresses them directly; Studio pages come closest.

## Voice

- Second person ("you"); "we" only inside tutorials, as the teacher alongside the learner.
- US spelling. Sentence-case headings. No emoji.
- The register follows the page type. Reference is austere and neutral. How-to guides are direct. Tutorials and explanation pages may be warmer and more discursive: a tutorial can point out what the learner should notice, and an explanation can weigh alternatives and give the project's view.

## Writing rules

The site follows ASD-STE100 (Simplified Technical English) about 80% of the way. Full STE reads dry, so the site keeps the STE rules that make text clear and softens the rest.

**Keep:**

- **One idea per sentence.** When a sentence joins two ideas with "and", "which" or a semicolon, split it or make a list.
- **Active voice.** Name the actor: "`ask()` throws `TenantScopeError`", not "`TenantScopeError` is thrown".
- **Present tense.** Say what the software does: "returns", not "will return".
- **Commands for steps.** Start each step with a verb: "Run `askdb init`." Put a condition before the command: "If you use pnpm 11, approve the build."
- **One word for one meaning.** Use the terms in the [terminology table](#terminology) every time. Don't vary a term for style.
- **Numbers, not adjectives.** "1 MiB", "30 chunks", "60 s", not "large", "a few" or "quickly".
- **A risk first, with its reason.** Put the hazard before the instruction it qualifies, and say why: "Run generated SQL under a read-only role. The SQL checks are heuristics, not a security boundary."
- **No intensifiers or hedges.** Leave out "very", "just", "simply", "actually", "really" and "extremely". Instead of "usually" or "typically", state the condition under which something is true.

**Soften:**

- **Sentence length is a target, not a cap.** Aim for about 20 words in a step and 25 in a description. A longer sentence is fine when splitting it would separate a condition from its result.
- **Write for flow.** Contractions ("don't", "it's"), connecting words ("so", "but", "then", "because") and varied sentence openings are fine.
- **Common phrasal verbs are fine:** "set up", "log in", "look up", "fall back".
- **Warmth depends on the page type.** Tutorials and explanation pages may be warmer and more discursive than reference pages (see [Voice](#voice)).

**Drop:**

- **STE's approved-word dictionary.** It can't hold API names, product terms or the terminology table. Use the word a developer expects.

## Terminology

| Use | Instead of | Notes |
|---|---|---|
| schema artifact | describable schema, Schema v2 | Say "v2" only where the format version matters (`"version": 2` in `schema.json`). See #273. |
| reviewed schema context | describable context | |
| natural-language analytics | NL-to-SQL | In introductory sections; "NL-to-SQL" is fine in reference. |
| AskDB returns SQL | execution boundary | In beginner-facing sections. |
| your application owns execution | host owns execution | |
| large schemas | RAG | Until the concept is introduced. |
| the read-only check, the tenant check, the sensitive check; together, the SQL checks | validator, lint, guardrail (in prose) | API names keep "guardrail" (`sensitiveGuardrail`, `validateTenantGuardrails`). Say the checks are heuristics where it matters, but don't use "heuristic checks" as their name. |
| engine package | adapter | `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`. "Connector" is fine for what `create*Connector` returns. |
| Playground | Ask panel | Studio's view for asking a question. |

Introduce these only after the reader understands the product — fine in concept and reference pages, too early on Start pages and the first guides: RAG, BYO runtime, MCP, bounded results, headless contracts, dialect-agnostic, optional peers, runtime snapshot.

Model wiring has two first-party paths: `@askdb/ai`'s built-in providers (`createAiRegistry()`, `createAskDb({ config })`) and a raw Vercel AI SDK `LanguageModel` passed to `ask()`. Present both as equally supported; choose between them by who owns provider config. Name the deprecated `@askdb/ai-*` shims only in deprecation notes and migration tables.

## Site structure

| Sidebar section | Diátaxis type | Folder |
|---|---|---|
| Start | Tutorial (Quickstart), plus orientation pages, each of one type: Overview (explanation), Install (how-to), Studio (a tutorial-style tour of its views) | root |
| Guides | How-to guides, in groups by the reader's task: Build, Run in production, Tenancy, Maintain, Integrations | `guides/`, `guides/integrations/` |
| Concepts | Explanation | `concepts/` |
| Reference | Reference, in groups: Surfaces (CLI, HTTP API, configuration), Formats and rules, Packages and releases, APIs | `reference/` |

A sidebar group with no pages yet stays out of `astro.config.mjs` until its first page lands.

Every page is exactly one Diátaxis type. A sentence that belongs to another type moves to that type's page and is replaced by a link.

Page titles follow the type:

- **Tutorial:** what the learner builds ("Quickstart" is the one exception, for findability).
- **How-to guide:** the reader's goal as a command ("Deploy AskDB as an HTTP service"). The sidebar label may shorten it.
- **Explanation:** a noun phrase that reads after "About" ("Safety boundaries", "The schema artifact").
- **Reference:** the thing it describes ("CLI reference", "@askdb/core API reference").

The sidebar is hand-written in `astro.config.mjs`; every new page needs an entry there. A page that moves or is deleted gets an entry in `redirects` in the same file, so old links and bookmarks still land. Links in the docs go to the new path, since a redirect drops the `#anchor`. Pages open with `<p class="doc-eyebrow">` and `<p class="doc-lede">` and end with a "Read next" section linking the natural next pages.

The `starlight-llms-txt` `details` string in `astro.config.mjs` summarises the site structure for LLMs — update it when sections change.

## Tooling

- Docs tool: Astro Starlight
- Content root: `apps/docs-site/src/content/docs/`
- Navigation file: `apps/docs-site/astro.config.mjs` (`sidebar`)
- Dev server: `pnpm docs:dev` (127.0.0.1:4310)
- Build / check: `pnpm docs:build`; `pnpm -C apps/docs-site test` (builds the site, then fails on an internal link to a missing page or `#anchor`); `pnpm -C apps/docs-site lint` (`astro check`)
- Source lines: one line per paragraph, soft-wrapped by the editor (see `AGENTS.md`).
- Internal links: root-absolute (`/guides/embed-in-node/`); a remark plugin rebases them.

## Components

- `InstallTabs` (`<InstallTabs pkgs="…" />`) for every package install. The Quickstart is the exception: it uses hand-written `Tabs` (`syncKey="pkg"`) with npm and Yarn only, since its install is a dev dependency, which `InstallTabs` can't express, and pnpm can't run it in a new project until [#750](https://github.com/Ygilany/AskDB/issues/750)'s fix is released.
- `Tabs` with a `syncKey` so choices persist site-wide: `pkg` (labels exactly npm / pnpm / yarn), `engine` (database engines), `wiring` (config-driven vs direct model).
- `Aside` for prerequisites and real hazards — `note`, `tip`, `caution`; keep them rare.
- `ExampleLink` to point at a runnable example in the repo.
- Diagrams are written in [D2](https://d2lang.com/) and rendered to inline SVG at build time by `astro-d2`. CI and the Pages deploy need no D2 binary. See "Diagrams" below.

## Diagrams

- Put a diagram's source in `src/assets/diagrams/d2/<name>.d2` and show it with a `d2` fence: ```` ```d2 src="../../assets/diagrams/d2/<name>.d2" ```` (the `src` path is relative to the page). A short diagram can go in the fence body instead.
- Wrap the fence in `<figure style="--d2-width: 334px">` and set the value to the diagram's natural width: the third number of the outer `viewBox` in the built page (`viewBox="0 0 334 619"` is 334 wide). Without it, the diagram stretches to fill the content column. Don't use the fence's `width` or `title` attributes: `astro-d2` ignores both with D2's WebAssembly build ([astro-d2#69](https://github.com/HiDeoo/astro-d2/issues/69)).
- End the figure with a `<figcaption>` that says what the diagram shows. It is the diagram's text alternative. Leave a blank line before and after the fence, or MDX doesn't render it.
- Keep the natural width at 720 px or less, the content column at its widest. With the table of contents showing, the column is narrower (632 px in a 1280 px window), so a wider diagram scales down. A flow of four or more steps reads better top to bottom (`direction: down`): the text then stays full size on a phone.
- Use D2's default palette only. `custom.css` maps it to the site's colors, so the diagram follows the light and dark toggle. A hard-coded color (`style.fill: "#…"`) does not follow it.
- Use the same words in node labels as on the page: command names, package names and terms from "Terminology".
- Keep labels to plain text. D2's own stylesheet doesn't reach the page ([astro#18652](https://github.com/withastro/astro/issues/18652); `custom.css` stands in for the parts a diagram needs), so labels render in the site font, and Markdown labels and sketch mode lose their styling.
- The older diagrams in `src/assets/diagrams/*.svg` are hand-drawn. Redraw one in D2 when its page changes.

## Code samples

- TypeScript for library code; bash for commands. Standalone command snippets use `npx` (readers substitute `pnpm dlx` / `yarn dlx`); multi-command flows use `pkg` tabs.
- Samples show AskDB returning SQL; any execution runs through the reader's own connection (`pg`, Prisma, …), never through AskDB.
- Placeholders: environment variables (`process.env.OPENAI_API_KEY`) rather than inline fake keys.

## Sources of truth

- Verify every API, option, default, flag, config key, route, and path against source in `packages/*` and `apps/*` before writing it. Never invent package names, APIs, or paths.
- Behaviour contracts: `docs/contracts/`; decisions: `docs/adrs/`; package boundaries: `docs/architecture.md`; product intent: `docs/mission.md`.
- The docs must never claim AskDB executes SQL, owns credentials, or trains on customer data.

## Process

- A public API change or new integration pattern ships with its docs update in the same PR.
- Docs vs behaviour discrepancies found while writing go to GitHub Issues with the `discrepancy` label (see `docs/agents/issue-tracker.md`); audits and multi-step docs plans go there with `plan` + `documentation`.
- Add a changeset for `@askdb/docs-site` (patch) with docs changes, like any package.
- New pages and restructures: propose the outline first. Edits to existing pages: proceed.
