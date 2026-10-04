# Code review profile

How `copilot-style-review` reviews this repo. `/setup-ygilany-skills` seeded it; edit it directly as the repo changes.

## Repo

- **Base branch:** `origin/main`
- **Copilot's prior findings:** inline comments by `Copilot`, review summaries by `copilot-pull-request-reviewer[bot]`

## Docs to read

The docs a review checks the diff against, beyond `AGENTS.md`: `CONTRIBUTING.md`; `docs/mission.md` (principles, non-goals), `docs/architecture.md` (package boundaries, install profiles), the contracts in `docs/contracts/`, the ADRs in `docs/adrs/`, and the specs in `docs/specs/` that the diff touches or names; the public docs site under `apps/docs-site/src/content/docs/` and its house style `apps/docs-site/STYLE.md` for any docs diff; `SECURITY.md` and each package `README.md` for claims about SQL checks; `CONTEXT.md` for glossary terms; `docs/release.md` for release workflow changes; and, for a consumer lab diff, `examples/consumer-lab/README.md`, `docs/specs/consumer-lab.md` and `.agents/skills/consumer-lab/SKILL.md`.

## Policy checks

Rules from the agent instructions and contributing guide that a diff can break, each with its source:

- AskDB returns SQL and never executes it: no code path in `packages/core` runs generated SQL against a database, and no doc claims AskDB executes SQL, owns credentials or trains on customer data (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Safety Boundary"; `apps/docs-site/STYLE.md`, "Sources of truth")
- A package public API change or a new integration pattern updates `apps/docs-site` in the same change; a package README alone is not the public docs surface (`AGENTS.md`, "Where product/architecture decisions live" and "Conventions")
- Docs-site claims name only package names, APIs and file paths that exist in source (`AGENTS.md`, "Conventions")
- Built-in `@askdb/ai` providers and a raw Vercel AI SDK `LanguageModel` are presented as equally supported; new docs and examples don't point at the deprecated `@askdb/ai-*` shims, and no code is added under `packages/ai-*` (`AGENTS.md`, "Stack" and "Conventions")
- Library packages declare `ai` as a peer and each `@ai-sdk/*` SDK as an optional peer with a wide floor, never a hard pin (`AGENTS.md`, "Conventions")
- An optional peer is imported lazily with the `.catch()` chained directly on the `import()`, the pattern in `packages/ai/src/providers/optional-peer.ts`; engine drivers follow it too (`AGENTS.md`, "Conventions")
- A dependency floor rises only by hand, for a security fix or a needed version, with a changeset naming which; raising an `ai` or `@ai-sdk/openai` floor raises the consumer lab's host pin with it (`AGENTS.md`, "Conventions"; ADR 0015)
- Published packages declare `engines.node` `>=22.14`, and private workspace packages don't advertise a floor below the 22.14 development floor (`AGENTS.md`, "Stack")
- Behavior that affects public APIs, package output, SQL safety or validation, or user-facing workflows has a test (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, intro)
- A package integration suite is gated with `integrationSuite()` from `scripts/test-utils/integration.mjs`, and a new gating variable is listed in the `test` task's `env` in `turbo.json`; an engine-level test that needs a real schema uses the multi-engine fixture; consumer lab tests deliberately don't use `integrationSuite()` and fail on a missing fixture (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Integration Tests", "Multi-engine fixture" and "Consumer lab")
- Every change to a publishable package has a changeset, and a breaking public API change (removed export, raised Node floor, restrictive `exports`, changed accepted input) is a minor bump, not a patch, while AskDB is pre-1.0 (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Before Opening a PR")
- Docs-site changes carry a patch changeset for `@askdb/docs-site` (`apps/docs-site/STYLE.md`, "Process")
- The consumer lab's committed `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` stay the `npm:latest` baseline: no `file:` paths or other targets committed, except in a baseline refresh (`CONTRIBUTING.md`, "Consumer lab")
- Lab test names start with `[<dialect>] <scenario-id>` so `lab:matrix` can place them (`CONTRIBUTING.md`, "Consumer lab")
- Every `allowlist` entry in `.audit-ci.json` has a row in the advisory table, scoped to its path where possible (`CONTRIBUTING.md`, "Dependency Audit")
- No real `.env` files, API keys, database credentials, customer schemas or production query outputs are committed (`CONTRIBUTING.md`, "Safety Boundary")
- Unimplemented plans, specs and doc/behavior discrepancies go to GitHub Issues, not new files in the repo (`AGENTS.md`, "Agent skills", "Issue tracker")
- Markdown and MDX use one line per paragraph or list item, with no hard wraps in prose (`AGENTS.md`, "Conventions")

## Guardrails

- **Safe to run:** `pnpm lint` and a package's `tsc --noEmit`; focused package tests, including integration suites with `ASKDB_FIXTURE_HOST=127.0.0.1`, which read the multi-engine fixture; queries against the fixture as the read-only `fixture_reader` role; the SQLite fixture file, which belongs to the checkout; the consumer lab's focused tests (`pnpm lab:test <file>` or `pnpm lab:test -t '<scenario-id>'`, against the install already there); `pnpm lab ask`; writes to the lab's gitignored `.lab/` caches (`.lab/artifacts`, scratch projects); a server you start, poke and stop; `pnpm smoke:install` and `pnpm test:ai-floors`, which work in temp directories.
- **Out of bounds:** the multi-engine fixture's Postgres, MySQL, MariaDB and SQL Server containers and the consumer lab's own Postgres are shared with other worktrees and agents, so never run `pnpm fixture:up`, `fixture:reset`, `fixture:down`, `lab:up`, `lab:reset`, `lab:down`, `lab:matrix` (it runs `lab:up` first) or the lab's `postgres:up`, `postgres:down` and `postgres:reset`; `pnpm lab:use` in any form, `--restore` included, because it rewrites the lab's committed manifests; writes to the fixture's databases, which belong on a scratch copy (`lab_scratch_<token>`) or a second fixture copy from another worktree; and `docker compose down` on any fixture compose file, `pnpm pgvector:down` and `pgvector:reset` included. The `consumer-lab` skill's "Shared fixture guardrails" apply.

## What Copilot flags here

Sampled 2026-10-04 from 134 top-level Copilot comments on 36 PRs (#181 to #444), posted 2026-09-27 to 2026-10-04. Counts are approximate, since a few findings sit between classes. Weight the review toward these:

- **Claims that contradict the code** (about 56, the largest class): one correction left sibling docs stale; a PR description promised exports, tests or verification results the diff doesn't carry; a documented command failed as written.
  - A correction says the CLI no longer executes SQL, but `docs/specs/core-pipeline.md`'s overview still says it does (#184)
  - The PR description promises `redactConnectionString` exports, but the diff ships parsed-part `connectionLabel()` APIs instead (#189)
  - A documented recovery command omits `-f examples/consumer-lab/compose.yml` and the `LAB_REGISTRY_*` values, so it can't work as printed (#444)
- **Edge inputs silently accepted** (about 23):
  - JSON `null` for the body mode is treated as absent and runs with the default mode instead of returning `400 bad_request` (#187)
  - Tenant root labels `Sub Agency` and `Sub-Agency` both normalize to `:tenant_sub_agency_ids`, so one root's IDs substitute for the other's (#375)
  - RAG chunk IDs aren't injective, because `schemaId` and `localId` may both contain `:` (#193)
- **Gate bypasses** (about 18), almost all in the SQL guardrails; try the dialect quirks: quoted identifiers, join hints, `OUTER APPLY`, nested set operations, comment syntax, escape strings, SELECT modifiers.
  - SQL Server `LEFT HASH JOIN` and `OUTER APPLY` are read as filtering joins, so a tenant predicate on the preserved side passes strict mode (#341)
  - PostgreSQL `E'it\'s agency_id'` is mis-tokenized, leaving `agency_id` visible as code and passing the tenant check without a predicate (#197)
  - MySQL `SELECT DISTINCTROW * FROM users` never sets the bare-star flag, so `users.ssn` isn't reported (#190)
- **Tests that can't fail** (about 15):
  - `it.fails` records any exception from a helper as the known failure, so a spawn or fetch error shows `known` instead of `FAIL` (#383, also #322)
  - A test builds config with a test-only runtime setter that production bootstrap can't produce (#199)
  - The AI SDK 6 smoke's `tsconfig.json` skips library checking, hiding declaration incompatibilities it exists to catch (#196)
- **Repo policy** (about 9):
  - Removing a public `connectionLabel` export ships under a patch changeset (#199)
  - New `@askdb/config` exports with no docs-site reference update (#437)
  - Engine driver imports moved out of their `try` without a chained `.catch()`, so esbuild treats optional peers as required (#195)
- **Lifecycle and failure paths** (about 9), concentrated in the consumer lab's scripts:
  - `lab:use` fails after rewriting `package.json`, and `fail()` exits before `main()` can roll back (#369)
  - The lab Postgres seeder runs before the advisory lock, so two concurrent `postgres:up` runs race on DDL (#441)
  - The lab UI's signal handler closes only the HTTP server; an open database socket keeps the CLI alive (#442)

Also recurring, without a class of their own:

- **Install commands missing a required peer:** Yarn doesn't auto-install peers, so every documented install of a package that loads `@askdb/core` must list `ai` (#196, three comments across the docs site, READMEs and `docs/architecture.md`).
- **Third-party semantics:** claims about GitHub, Dependabot and Changesets behavior checked against vendor docs, such as `exclude-paths` applying to version updates only (#408) and a review payload missing `start_side` (#326).
- **Redundant tests:** a mock-only test that duplicates a stronger real-boundary proof, or a regression row that can't prove its claim, recommended for removal (#196, #190).

## Example comment

One of Copilot's comments here, quoted, for its register:

> This new failure path runs after `package.json` has already been rewritten, and `fail()` exits the process before `main()` can call its rollback. If the block is misplaced, `lab:use` therefore reports failure but leaves the direct AskDB dependencies switched (reproduced with `askdb` changing from `old` to `1.0.0`). Validate the workspace block before writing either manifest, or make `pinTo` propagate an error that `main` rolls back. (#369)

## Posting

- **Footer:** `Thread ID: <thread-uuid> (worktree <worktree-name>)`, the line `AGENTS.md` ("Conventions") asks for on PRs and issues; the worktree directory name is not the thread ID, so look the UUID up as `docs/agents/project-board.md` (**Thread lines**) describes.
