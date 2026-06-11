# Plan 003: Bring architecture docs and ADR statuses in line with the shipped package layout

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 154b17e..HEAD -- docs/architecture.md docs/adrs README.md docs/platform.md`
> Compare the "Current state" excerpts against the live files; line numbers may
> shift if plans 001/002 touched docs — locate sections by heading, not line.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-ai-adapter-contract-v2.md (describe the post-001 contract, not the old one)
- **Category**: docs
- **Planned at**: commit `154b17e`, 2026-06-11

## Why this matters

`docs/architecture.md` calls itself "the canonical architecture guide" but its package map, package table, and dependency-boundary diagram omit eight published packages: `@askdb/ai`, `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/connectors`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver` — while the install-profiles table on the same page already references several of them. ADRs 0006 (AI provider strategy) and 0007 (connector registry) are implemented and shipped but still say "Proposed". And `README.md:63` plus `docs/platform.md:101` promise "per-provider model recipes (OpenAI, Anthropic, Bedrock, Ollama, AI Gateway)" in `docs/integration/installable-package.md`, which contains none of those recipes (verified by grep — zero matches for anthropic/bedrock/ollama). A canonical doc that contradicts the repo trains readers to ignore it.

## Current state

- `docs/architecture.md`
  - "Package map" mermaid (lines 38–78): subgraphs Contracts / Integrations / Surfaces; lists core, introspect, enrich, rag, postgres, prisma, cli, http, tui, studio, docsSite. No AI packages, no connectors/mysql/sqlite/sqlserver.
  - Package table (lines 80–92): rows for the same packages only.
  - "Dependency boundaries" mermaid (lines 98–129): same omissions.
  - "Boundary rules" bullets (lines 131–138): no rule for the AI layer; last bullet says "First-party apps can be batteries-included…".
  - Install profiles table (lines 268–278): already mentions `@askdb/ai` and adapters (rows "Minimal Postgres SQL generation", "CLI workflow", "Terminal enrichment", "Local browser Studio") — the diagrams above contradict it.
  - "Extension points" table (lines 291–298): no row for AI provider adapters.
- `docs/adrs/0006-ai-provider-integration-strategy.md` — `## Status` → `Proposed.`; its Consequences section still says "Adding a new provider is a new `@askdb/ai-*` package **plus a config branch**" (out of date once plan 001 lands).
- `docs/adrs/0007-connector-registry.md` — `## Status` → `Proposed.`
- `docs/adrs/0002-integration-package-layout.md` uses the dated-status convention: `Status: Accepted (2026-05-10).`
- `README.md:63`: "Per-provider model recipes (OpenAI, Anthropic, Bedrock, Ollama, AI Gateway) and introspection recipes live in [`docs/integration/installable-package.md`]…"
- `docs/platform.md:101`: "…Customers wire OpenAI, Anthropic, Google, Bedrock, AI Gateway, Ollama, etc. … Per-provider recipes in [`docs/integration/installable-package.md`]."
- True dependency facts to draw (verified from package.json files at `154b17e`):
  - `ai-openai`/`ai-azure`/`ai-google` → `@askdb/ai`; `@askdb/ai` peers on `ai` (post-001).
  - `askdb` (cli), `@askdb/http-api`, `@askdb/studio`, `@askdb/tui` → `@askdb/ai` + all three adapters.
  - `@askdb/connectors` is the connector registry (ADR 0007); `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver` are engine integrations alongside `@askdb/postgres`/`@askdb/prisma`. Confirm each one's actual deps by reading `packages/{connectors,mysql,sqlite,sqlserver}/package.json` before drawing edges — do not guess.
- Docs conventions: GitHub-flavored markdown, mermaid `flowchart`, tables with `| --- |` separators; docs-site mirrors selected files (`apps/docs-site`), built with `pnpm docs:build`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Verify deps before drawing | `cat packages/<pkg>/package.json` | read `dependencies` |
| Docs site build (validates pages render) | `pnpm docs:build` | exit 0 |
| Mermaid sanity | visual check or `npx -y @mermaid-js/mermaid-cli -i /dev/stdin` if available; otherwise rely on docs build + careful syntax | no parse errors |

## Scope

**In scope**:

- `docs/architecture.md`
- `docs/adrs/0006-ai-provider-integration-strategy.md`, `docs/adrs/0007-connector-registry.md`
- `README.md` (line 63 sentence only), `docs/platform.md` (line 101 sentence only)
- `.changeset/<new-file>.md` only if the repo's convention requires changesets for docs-only changes — check `git log --oneline --follow docs/architecture.md` for precedent; if past docs-only commits shipped without changesets, skip it.

**Out of scope**:

- `docs/integration/installable-package.md` — adding the Anthropic recipe is plan 004; this plan makes the claims truthful for what exists *now*.
- Any source code or package.json.
- `apps/docs-site` content copies — only if the build pulls these files automatically (it mirrors markdown; no manual copy step expected).

## Git workflow

- Branch: `advisor/003-architecture-docs-refresh`.
- Commit style: `docs: …` (repo example: `docs: add authorship attribution to docs site footer and all READMEs`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the missing packages to the package-map diagram and table

In `docs/architecture.md` "Package map" mermaid, add:

- To `Contracts`: `ai["@askdb/ai<br/>provider registry and env config resolution"]`.
- To `Integrations`: `aiOpenai["@askdb/ai-openai"]`, `aiAzure["@askdb/ai-azure"]`, `aiGoogle["@askdb/ai-google"]`, `connectors["@askdb/connectors<br/>connector registry"]`, `mysql["@askdb/mysql"]`, `sqlite["@askdb/sqlite"]`, `sqlserver["@askdb/sqlserver"]`.
- Edges: each `ai-*` → `ai`; `cli`/`http`/`studio`/`tui` → `ai` and → the three adapters (to keep the diagram readable you may draw surface → adapters and adapters → ai only, with a note that surfaces also import `@askdb/ai` directly); connector edges per the package.json facts you verified (expected: `cli` → `connectors`, `connectors`/engine packages → `introspect`; confirm).

Add table rows (match the existing two-sentence "Purpose / Boundary" style), e.g.:

- `@askdb/ai` — "Provider-agnostic AI registry: adapter contract, env/config resolution precedence (`ASKDB_AI_*`), model factories for apps." / Boundary: "No provider SDKs; provider knowledge lives in `@askdb/ai-*` adapters."
- One row per adapter; one row each for `@askdb/connectors`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver` (derive purpose from each package's README — read it first).

**Verify**: `grep -c "@askdb/ai" docs/architecture.md` → noticeably higher than before (was 5); every new mermaid node id is unique within its diagram.

### Step 2: Update the dependency-boundaries diagram and boundary rules

Add the same nodes/edges to the "Dependency boundaries" mermaid. Then append two boundary-rule bullets:

- "`@askdb/ai` owns provider dispatch and the universal env precedence; each `@askdb/ai-*` adapter owns its provider's SDK, native env vars, and defaults. Core stays BYO-model: `ask()` takes any AI SDK `LanguageModel` and never depends on `@askdb/ai`."
- "First-party surfaces (`askdb`, `@askdb/http-api`, `@askdb/studio`, `@askdb/tui`) are deliberately batteries-included: they hard-depend on all first-party adapters so env config alone selects a provider. Library packages must not."

**Verify**: rendered mermaid parses (docs build in Step 5); `grep -n "batteries-included" docs/architecture.md` → 2 matches (existing bullet + new one).

### Step 3: Add the AI extension point and fix the recipe claims

- "Extension points" table: add row — `AI provider adapter | @askdb/ai contract, implemented by @askdb/ai-* packages | AiProviderAdapter | Add a model provider that resolves from AskDB env/config; BYO-model via ask() needs no adapter.`
- `README.md:63` and `docs/platform.md:101`: rewrite the recipe claim to match reality, e.g. "Per-provider model recipes (OpenAI, Azure OpenAI / Foundry, Google Gemini, plus any OpenAI-compatible endpoint such as Ollama or an AI gateway via `ASKDB_AI_BASE_URL`) and introspection recipes live in …". Before writing, skim `docs/integration/installable-package.md` and name only what it actually documents.

**Verify**: `grep -rn -i "bedrock" README.md docs/platform.md` → no matches (until a real Bedrock recipe exists).

### Step 4: Flip ADR statuses and amend ADR 0006

- `docs/adrs/0006-ai-provider-integration-strategy.md`: `## Status` → `Accepted (<today's date>).` Append an `## Amendments` section: "2026-06: Implemented, then extended — `@askdb/ai` no longer hard-codes provider env vars; adapters are self-describing (`resolveConfig`, `aliases`, `providerOptions`), `AiProvider` is an open string, and `ai` is a peer dependency of `@askdb/ai` and adapters. Supersedes the consequence 'a new provider … plus a config branch': a config branch is now only needed for `askdb.config.*` authoring support, not for env-driven use." Adjust wording to match what plan 001 actually shipped (read its changeset).
- `docs/adrs/0007-connector-registry.md`: `## Status` → `Accepted (<today's date>).` (Only if `@askdb/connectors` is indeed shipped and used by the CLI — verify with `grep -rn "@askdb/connectors" apps/cli/package.json`; if it is not actually wired in, leave 0007 alone and report.)

**Verify**: `grep -n "Proposed" docs/adrs/0006*.md docs/adrs/0007*.md` → no matches (assuming 0007 qualified).

### Step 5: Build gate

**Verify**: `pnpm docs:build` → exit 0. Visually spot-check the two edited mermaid blocks (paste into mermaid.live if unsure) — a syntax error renders as a broken diagram, not a build failure, so the build alone is not sufficient for the diagrams.

## Test plan

Docs-only: the "tests" are `pnpm docs:build` plus the grep checks above. No unit tests.

## Done criteria

- [ ] `pnpm docs:build` exits 0
- [ ] Package-map and dependency-boundaries diagrams + package table list all of: `@askdb/ai`, `ai-openai`, `ai-azure`, `ai-google`, `@askdb/connectors`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`
- [ ] `grep -n "Proposed" docs/adrs/0006*.md` → no match; 0007 likewise (or a reported reason it stays Proposed)
- [ ] `grep -rn -i "anthropic\|bedrock" README.md docs/platform.md` → no claims of recipes that don't exist
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A dependency edge you're about to draw contradicts the package.json you read (don't draw aspirational edges).
- `@askdb/connectors` turns out not to be consumed by the CLI/apps (then ADR 0007 may genuinely still be "Proposed" — report instead of flipping it).
- Plan 001 is not merged — then the ADR 0006 amendment text would describe an architecture that doesn't exist; either wait or write the amendment for the current state and say so.

## Maintenance notes

- Whenever a package is added under `packages/*`, this doc's two diagrams + table + install profiles must be updated in the same PR — consider adding that to `CONTRIBUTING.md` later (deferred).
- Plan 004 adds `@askdb/ai-anthropic`; whoever executes it must add the node/row here too (its plan says so).
