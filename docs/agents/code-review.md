# Code review profile

How `code-review` reviews this repo. `/setup-ygilany-skills` seeded it; edit it directly as the repo changes. The skill reads the H2 (`##`) headings by name, so keep them; everything inside a section is free-form. Point at existing docs instead of copying them. A section a lens has nothing to add to can stay empty or be removed; the lens then works from its defaults.

*Repo* and *When review is required* come first, then one section per lens, in the order the lenses run (Spec, Standards, Architecture, Defects, Tests, Docs), then the shared sections, starting with *What code review flags*, which every lens reads. Each rule sits in the section of the one lens that checks it. Any lens can also carry a `Tier:` line (`light`, `standard` or `deep`) to override its default model tier.

## Repo

- **Base branch:** `origin/main`
- **Reviewer accounts:** `Copilot` (inline review comments) and `copilot-pull-request-reviewer[bot]` (review summaries, which list the inline findings and add none of their own). No human reviewer's comments are sampled.

## When review is required

Every PR before it leaves draft; always for PRs an agent authored.

## Spec

Where requirements come from, read by the Spec lens.

- **Issue tracker:** `docs/agents/issue-tracker.md` (GitHub Issues on `Ygilany/AskDB`; read one with `gh issue view <n> --comments`). Implementation plans are issues labelled `plan`; specs not yet built are issues labelled `enhancement`; a PR that implements an issue says `Closes #<n>`.
- **Spec files:** `docs/specs/` and `docs/contracts/` describe settled, built behaviour (the "constitution"); read the ones the diff touches or names. `plans/` is closed to new plans and keeps only implemented ones as history (`plans/README.md`). For a consumer lab diff, `docs/specs/consumer-lab.md`.

### Description vs diff

- Every box ticked in the PR template's checklist (tests, changeset, `pnpm smoke:install && pnpm preflight`, no SQL execution added, no secrets) is true of the diff.
- Verification results in the body (matrix cells, test counts, "`pnpm preflight` passes") match the head SHA and the committed manifests, not a run from before a rebase (#381).
- Export tables and API names in the body match the package entry points at the head SHA; in a stack, after a lower PR changed design, the upper PR's description still describes its own layer (#189, #195, #199).
- Each `Closes #<n>` issue's acceptance criteria are met as written, not a narrower reading (#443).

## Standards

Rules a diff can break and a reviewer can check, each with its source. Read `AGENTS.md` and `CONTRIBUTING.md` for the full text. Rules owned by another lens sit in that lens's section: SQL is never executed by AskDB and changeset levels for breaking changes (*Architecture*), required tests and integration-suite gating (*Tests*), docs-site updates, docs claims and changesets (*Docs*).

- Built-in `@askdb/ai` providers and a raw Vercel AI SDK `LanguageModel` are presented as equally supported; new docs and examples don't point at the deprecated `@askdb/ai-*` shims, and no code is added under `packages/ai-*` (`AGENTS.md`, "Stack" and "Conventions")
- Library packages declare `ai` as a peer and each `@ai-sdk/*` SDK as an optional peer with a wide floor, never a hard pin (`AGENTS.md`, "Conventions")
- An optional peer is imported lazily with the `.catch()` chained directly on the `import()`, the pattern in `packages/ai/src/providers/optional-peer.ts`; engine drivers follow it too (`AGENTS.md`, "Conventions")
- A dependency floor rises only by hand, for a security fix or a needed version, with a changeset naming which; raising an `ai` or `@ai-sdk/openai` floor raises the consumer lab's host pin with it (`AGENTS.md`, "Conventions"; ADR 0015)
- Published packages declare `engines.node` `>=22.14`, and private workspace packages don't advertise a floor below the 22.14 development floor (`AGENTS.md`, "Stack")
- The consumer lab's committed `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` stay the `npm:latest` baseline: no `file:` paths or other targets committed, except in a baseline refresh (`CONTRIBUTING.md`, "Consumer lab")
- Lab test names start with `[<dialect>] <scenario-id>` so `lab:matrix` can place them (`CONTRIBUTING.md`, "Consumer lab")
- Every `allowlist` entry in `.audit-ci.json` has a row in the advisory table, scoped to its path where possible (`CONTRIBUTING.md`, "Dependency Audit")
- No real `.env` files, API keys, database credentials, customer schemas or production query outputs are committed (`CONTRIBUTING.md`, "Safety Boundary"; PR template)
- Unimplemented plans, specs and doc/behavior discrepancies go to GitHub Issues, not new files in the repo (`AGENTS.md`, "Agent skills", "Issue tracker")
- Domain terms are used as `CONTEXT.md` and `docs/contracts/` define them (`docs/agents/domain.md`)
- Markdown and MDX use one line per paragraph or list item, with no hard wraps in prose (`AGENTS.md`, "Conventions")
- **Enforced by tooling:** `pnpm lint` (each package's `tsc --noEmit`, Studio's ESLint and `tsconfig.web.json` typecheck, the docs site's `astro check`); `pnpm run audit` (moderate or higher advisories, stale allowlist entries); the Changesets workflow (a changeset exists when `packages/*/src`, `apps/{cli,http-api,studio}/src` or a manifest outside `devDependencies` changes, but not its bump level, and not for `apps/docs-site`); the consumer-lab job's frozen-lockfile check of the lab's manifest against its lockfile; `pnpm test:ai-floors` (AI SDK peer floors); `pnpm smoke:install` and the publish dry-run; React Doctor on PRs. There is no formatter.
- **Smell baseline:** applies by default. Endorsed here: `@askdb/config`'s own provider list duplicating `BUILTIN_AI_PROVIDERS`, guarded by a drift test in `@askdb/client` (`docs/architecture.md`, "Dependency boundaries"); the `packages/ai-*` re-export shims (Middle Man) until #347 removes them.

## Architecture

- Sources: `docs/architecture.md` ("Package map", "Dependency boundaries", "Install profiles", "Extension points"), `docs/mission.md` (principles, non-goals), ADR 0002 (integration-package layout).
- Layers, lowest first: `@askdb/core` (schema and NL-to-SQL contract; takes a dialect, a model, an optional retriever and a schema, returns SQL); `@askdb/introspect` (engine-agnostic connector contract), then `@askdb/connectors` (registry); the engine packages `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`, plus `@askdb/enrich` and the optional `@askdb/rag`; `@askdb/ai` (provider registry and built-ins) and `@askdb/config` (config and env bootstrap); `@askdb/client` (facade over core, ai and config); the apps `askdb`, `@askdb/http-api`, `@askdb/studio`. Imports only point down: core never depends on `@askdb/ai`, a provider SDK or `@askdb/client`; `@askdb/config` doesn't depend on `@askdb/ai`.
- AskDB returns SQL and never executes it: no code path in `packages/core` runs generated SQL against a database; execution belongs in a host app or a fixture/test harness, and Studio's opt-in Playground Execute is the one documented exception (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Safety Boundary"; `SECURITY.md`).
- Where code belongs: engine-specific knowledge (dialect, catalog queries, input shape) in its engine package (ADR 0002); each built-in AI provider in one file under `packages/ai/src/providers/` with one row in `BUILTIN_AI_PROVIDERS` (ADR 0006); authoring logic in `@askdb/enrich`, not duplicated in Studio or the CLI (ADR 0004); `process.env` read only by `@askdb/config`, others go through `getAskDbRuntimeConfig()` (ADR 0005); apps dispatch through the connector registry, never a per-engine switch (ADR 0007); library packages don't hard-depend on optional drivers or provider SDKs, while the first-party apps may (`docs/architecture.md`, "Dependency boundaries").
- A fix belongs in the layer that owns the defect, not in the caller that hit it (for example the empty-store width rule fixed in `MemoryStore.restore()`, #193); in a stack, in the lower PR that introduced it (#195).
- **Public surface:** each package's `exports` map and `src/index.ts`; `askdb` publishes only its binary, so `runIntrospectCli` and similar are internal (#199).
- **Versioning rule:** while AskDB is pre-1.0, a breaking change (removed or renamed export, raised Node floor, restrictive `exports`, changed accepted input or default) is a minor bump, not a patch (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Before Opening a PR"). Removing an export that never reached `main` is not breaking (maintainer's ruling on #199). Published ranges move on purpose (ADR 0015).

### Decision records

- Records: `docs/adrs/NNNN-title.md`, each with Status, Context, Decision, Alternatives and Consequences. Numbering has gaps: 0008, 0010, 0011, 0013 and 0017 sit in open PRs (#199, #311, #189/#195, #181, #454).
- Index: none on `main`. Draft PR #326 adds `docs/adrs/README.md` (one row per ADR: status, decision, what not to regress). Until it merges, read the Status and Decision sections of every ADR touching the changed paths.
- Needs a record: any choice between two or more clean options, any reversal of an accepted record. A change that contradicts an ADR amends or supersedes it in the same PR (`docs/agents/domain.md`, "Flag ADR conflicts").
- Once the index exists, a new record adds its row to the index in the same PR.

## Defects

### Sensitive areas

| Paths | Apply |
|---|---|
| `packages/core/src/sql/{validate,lexer,dialect-spec,extract-sql,sensitive-guardrail}.ts` | security review, SQL guardrails, latent defects block |
| `packages/core/src/sql/tenant-*.ts`, `packages/core/src/sql/{bind,parameter-manifest}.ts`, `packages/core/src/ask.ts` | security review, Tenant scope, latent defects block |
| `packages/core/src/sql/{sensitive-guardrail,prompt}.ts`, `packages/core/src/schema/**`, `packages/core/src/retrieval/**`, `packages/core/src/enrichment/**`, `packages/core/src/logging/**`, `packages/rag/src/chunker/**` | security review, Sensitive fields |
| `apps/studio/src/{server,request-guard,execute-registry,introspection,setup}.ts`, `apps/studio/src/web/**`, `apps/http-api/src/**` | security review, Local servers |
| `packages/*/src/exec/**`, `packages/*/src/connector/provider.ts`, `packages/connectors/src/**`, `packages/config/src/**`, `apps/cli/src/{init,introspect,project-config}.ts` | security review, Connection strings and secrets |
| `packages/enrich/src/workspace.ts` | security review, File writes |
| `packages/ai/src/providers/**`, `packages/*/src/exec/**` | Optional peers |
| `.github/workflows/**`, `scripts/release-*`, `scripts/pack-tarballs.sh`, `.changeset/config.json` | security review, CI and release gates |
| `examples/consumer-lab/src/**`, `fixtures/multi-engine/src/**` | Lab scripts |

### Checklists

#### SQL guardrails

- Every changed check reads SQL through the shared dialect lexer (`packages/core/src/sql/lexer.ts`) or mirrors its rules exactly: MySQL and MariaDB need whitespace or a control character after `--` and treat `#` as a comment; backslash escapes follow `DialectSpec.backslashEscapes`; PostgreSQL `E'…'` strings honour `\'` (#197); quoted and bracketed identifiers stay identifiers, never keywords (#341).
- An input the check cannot classify (unterminated string, identifier or comment; unknown join kind or clause) is rejected or reported, never passed.
- SELECT modifiers (`DISTINCT`, `DISTINCTROW`, `ALL`, `TOP`, `STRAIGHT_JOIN`) are skipped before reading the select list, so `SELECT DISTINCTROW * FROM users` still counts as a bare star (#190).
- A new dialect quirk has an accept and a reject case in that check's test table.
- `SECURITY.md` ("What AskDB guarantees", "What AskDB does not guarantee"), the `packages/core` README security note, ADR 0012 and the docs site's `concepts/safety-boundaries.mdx` still describe what the check catches and misses: checks are defense in depth and the SQL is "checked", never "validated".

#### Tenant scope

- With a tenant policy, `ask()` refuses to run without a valid `tenantScope`, and a `subtree` scope expands per root through `resolveTenantDescendants` or throws (ADR 0014; `SECURITY.md`).
- A tenant placeholder AskDB cannot bind throws; it is never returned raw.
- No two roots share a placeholder: labels that normalize to the same `:tenant_<label>_ids` are rejected (#375).
- A predicate counts only when the root's tenant column is compared with that root's placeholder and ANDed into `WHERE`, an inner-join `ON` or `HAVING`; not beside `OR`, under `NOT`, inside a string or comment, on the preserved side of an outer join (join hints `LOOP`, `HASH`, `MERGE`, `REMOTE` included) or inside `OUTER APPLY` (#341).
- Every set-operation branch that reads a scoped table carries its own predicate at every depth, inside derived tables and CTEs too, and a parenthesized top-level operand counts as a query block (#341).
- Hierarchy and polymorphic fallbacks accept only `path.root` and its ancestors, and tie the discriminator value to the root whose placeholder the ID predicate uses (#341; `docs/contracts/tenant-policy.md`).
- The check runs on the model's SQL before binding; bound tenant IDs are escaped for the dialect in `sql-only` mode and passed as driver parameters in `sql-params` mode (`SECURITY.md`; #371).
- Known gaps stay documented with their issues (#342, #399) rather than described as fixed.

#### Sensitive fields

- A `sensitive` mark propagates as `docs/contracts/schema-v2.md` ("Sensitive propagation") says, through the loader, normalizer and writer.
- With `omitSensitiveFromPrompt`, sensitive tables and columns are absent from the prompt, synthesized DDL, enrichment prompts and RAG chunks (`docs/contracts/sensitive-fields-and-modes.md`).
- The sensitive-reference check reports named sensitive columns, sensitive tables in `FROM`/`JOIN`, and columns reached through `SELECT *`, `t.*` or a whole-row reference; its known misses (#306 to #309) stay listed in `SECURITY.md`.
- Logs, error messages and redaction notices never contain sensitive identifiers or values.
- Sensitive-exclusion counters count chunks, not source sections (#193).

#### Local servers

- Studio checks the Host allowlist on every request, same-origin and JSON content type on mutating routes, and the per-launch session token on the API, and keeps `no-store` and frame denial (ADR 0009; `apps/studio/src/request-guard.ts`).
- Studio binds to `127.0.0.1` by default; Playground Execute stays off by default and, when enabled, validates with `validateSelectSql` for the execute engine's dialect and runs read-only with a row cap and, except on SQLite, a statement timeout (`SECURITY.md`, "Studio execute").
- The HTTP API answers a body field of the wrong type with `400 bad_request` instead of a default; JSON `null` means absent for optional fields (maintainer's decision on #187); config booleans such as `httpApi.allowSchemaOverride` are validated as booleans (#187).
- A server startup failure such as `EADDRINUSE` prints one line and exits 1 (#187).

#### Connection strings and secrets

- A connection string, password or API key never reaches logs, error messages, stdout, a schema artifact, a Studio page or a connection label; labels are rebuilt from parsed, allowlisted parts (host, port, database), never by masking the raw input (#189, #199).
- Connection-string parsers reject what they cannot classify (wrong scheme, whitespace or control characters, fragments, an `@` after the authority) and read IPv6 hosts and engine escaping (SQL Server `{…}` values) as the engine does (#189).
- A configured key, endpoint or named connection is never silently replaced by an empty default connection; a missing resolved connection fails at load (ADR 0016; #439).
- Scaffolded config (`askdb init`, Studio setup) loads for every provider it offers (#198).

#### File writes

- Workspace writes resolve the real path, refuse a symlinked directory or file, and avoid a check-then-write race (#181).

#### Optional peers

- Each optional peer (`@ai-sdk/*` SDKs, engine drivers) is imported with `.catch()` chained on the `import()`, so esbuild doesn't treat it as required (#195).
- A driver that resolves but fails to load is reported as a load failure, not as missing with an install hint (#195).

#### CI and release gates

- A gate fails closed: a missing, private or unparsable base manifest counts as changed (#432), and actor checks use the current event actor, not only the PR creator (#417).
- Vendor behaviour a gate relies on (Dependabot, Changesets, the GitHub API) is checked against the vendor's docs, for example `exclude-paths` covering version updates only (#408).
- Actions stay pinned by commit SHA, with `persist-credentials: false` on checkout.
- A check that must always report filters with a job-level `if:`, not a workflow-level `paths:` (`.github/workflows/ci.yml`, `changesets.yml`).

#### Lab scripts

- A command that rewrites manifests validates its inputs before writing any file, and every failure after a write rolls back (#369).
- Seeding and DDL run under one lock taken before the work starts (#441).
- Shutdown releases every server, socket, child process and timer on the success, signal and timeout paths, without relying on a SIGKILL fallback (#442).
- A printed recovery or cleanup command works as printed from the repo root, with the compose file, project name and required `LAB_REGISTRY_*` values (#444).
- Env values are range-checked, for example ports from 1 to 65535 (#441).

## Tests

- **One test by name:** `pnpm --filter <package> exec vitest run --config ../../vitest.config.ts <file> -t "<name>"`, for example `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts -t "OUTER APPLY"`. Tests that spawn `apps/cli/dist/cli.js` need `pnpm build` first (`pnpm test` builds through Turbo). Consumer lab: `pnpm lab:test <file>` or `pnpm lab:test -t '<scenario-id>'`, against the lab install already there. Taken from the package scripts and `pgvector:test`; not run while writing this profile.
- **Install in a scratch worktree:** none. A `pnpm install` in a fresh `git worktree` of this repo can rewire `node_modules` links shared with the main checkout, so no install is safe; the Tests lens records its old-code check as not run and relies on CI at the head SHA.
- **Env vars or services some tests need, and whether CI sets them:** `DATABASE_URL` (`@askdb/postgres` query runner), `ASKDB_FIXTURE_HOST` (live introspection against the multi-engine fixture), `MYSQL_DATABASE_URL`, `MSSQL_DATABASE_URL`, `ASKDB_PGVECTOR_URL` or `PGVECTOR_URL` (`@askdb/rag` pgvector store); unset, those `*.integration.test.ts` suites skip. CI's `test` job sets all of them plus `ASKDB_REQUIRE_INTEGRATION=1`, which turns a skip into a failure; `unit-node-matrix` sets none. A new gating variable must be gated with `integrationSuite()` from `scripts/test-utils/integration.mjs` and listed in the `test` task's `env` in `turbo.json`, or Turbo's strict env mode drops it; an engine-level test that needs a real schema uses the multi-engine fixture (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Integration Tests", "Multi-engine fixture"). Consumer lab tests deliberately don't use `integrationSuite()` and fail on a missing fixture or install (`CONTRIBUTING.md`, "Consumer lab").
- **CI workflows that run tests:** `.github/workflows/ci.yml` (`unit-node-matrix` on Node 22.14.0 and 24; `test` with Postgres, MySQL, SQL Server services and `pnpm fixture:up`; `preflight` with `smoke:install` and `test:ai-floors`; `consumer-lab`, skipped on docs-only PRs); `consumer-lab-published.yml` (after a release that published, weekly and manual); `pages.yml` runs the docs build and link check only on pushes to `main`, so PRs don't run it.
- Behaviour that affects public APIs, package output, SQL safety or validation, or user-facing workflows has a test (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, intro; PR template). The repo's `test-audit` skill (`.agents/skills/test-audit/`) is the fuller rubric; a mock-only test that duplicates a real-boundary proof is a removal candidate (#196).

## Docs

- **User-facing docs:** the docs site, `apps/docs-site/src/content/docs/` (askdb.tools, Astro Starlight; nav in `apps/docs-site/astro.config.mjs`), with the reference pages under `reference/` (`packages.mdx`, `core-api.mdx`, `client-api.mdx`, `config.mdx`, `cli.mdx`, `http-api.mdx`, `rag-api.mdx`, `ask-options.mdx`). Also `SECURITY.md` and each package `README.md` for claims about SQL checks, `CONTEXT.md` for glossary terms, `docs/release.md` for release workflow changes, and, for a consumer lab diff, `examples/consumer-lab/README.md` and `.agents/skills/consumer-lab/SKILL.md`. The constitution in `docs/` (`mission.md`, `architecture.md`, `contracts/`, `specs/`, `adrs/`) must stay consistent with the change.
- A package public API change or a new integration pattern updates `apps/docs-site` in the same PR; a package README alone is not the public docs surface, and the reference pages list every new export (`AGENTS.md`, "Where product/architecture decisions live" and "Conventions").
- Docs-site claims name only package names, APIs and file paths that exist in source (`AGENTS.md`, "Conventions"), and no doc claims AskDB executes SQL, owns credentials or trains on customer data (`apps/docs-site/STYLE.md`, "Sources of truth").
- Every documented install of a package that loads `@askdb/core` lists `ai`, because Yarn doesn't auto-install peers (#196).
- **Changelog or changeset rule:** every change to a publishable package has a changeset (`pnpm changeset`; the bump level is *Architecture*'s versioning rule) (`AGENTS.md`, "Conventions"; `CONTRIBUTING.md`, "Before Opening a PR"); docs-site changes carry a patch changeset for `@askdb/docs-site`, which CI doesn't check (`apps/docs-site/STYLE.md`, "Process").
- **House style:** `apps/docs-site/STYLE.md`. Its Terminology line naming the `@askdb/ai-*` adapters as a first-party path is stale (#456); follow `AGENTS.md` there.

## What code review flags

Every lens reads this section and weights its hunting toward its own classes, the larger ones first. Sampled 2026-10-05 from 114 top-level review comments by `Copilot` on 31 PRs (#181 to #444), posted 2026-09-29 to 2026-10-04; median 2 findings per review round (at most 7). Replies rejected 4 (#183, #187, #199, #311), left out; about 25 had no reply or an inconclusive one ("outdated") and are counted, so the counts below cover 110. A finding that fits two lenses is counted under the lens whose check it breaks first: missing docs-site updates and missing changesets under Docs, although `AGENTS.md` states those rules; a wrong ADR sentence under Docs, a security hole in an ADR's design under Defects. Each class belongs to the lens that owns it:

- **Docs: claims that contradict the code** (about 50, the largest class): one correction leaves sibling specs, ADRs, READMEs, reference pages or `SECURITY.md` stating the old behaviour; a documented command fails as printed; a new export or required peer is missing from the reference. After any correction, grep `docs/`, `apps/docs-site/`, every README, `SECURITY.md`, `CONTEXT.md` and `.agents/skills/` for the old claim.
  - A correction says the CLI no longer executes SQL, but `docs/specs/core-pipeline.md`'s overview still says it does (#184)
  - The lab README's private-copy commands omit the compose file and the lab's working directory, so they fail from the repo root (#441)
  - A new public `@askdb/introspect` export has no entry in the docs-site package reference (#189)
- **Defects: edge inputs silently accepted** (about 19): a blank, out-of-range, duplicate, oddly encoded or unknown value falls through to different behaviour. Try blank strings, the string `"false"` for a boolean, port `0` and `65536`, a typo cast through a union type, `:` inside IDs, Unicode case folding, reordered HTML attributes, an absent field on both sides of an equality.
  - Blank `sql` with a catalog question selected silently runs the question instead (#442)
  - `httpApi.allowSchemaOverride: "false"` is truthy, so the server enables schema overrides (#187)
  - RAG chunk IDs aren't injective, because `schemaId` and `localId` may both contain `:` (#193)
- **Defects: gate bypasses** (about 15), mostly the tenant guardrail (9 comments on #341), then CI gates and path containment. Try the dialect quirks in the *SQL guardrails* and *Tenant scope* checklists, a new public manifest or a maintainer push on a bot branch for CI gates, and symlinks for path checks.
  - SQL Server `LEFT HASH JOIN` is read as an inner join, so a predicate on the preserved side passes strict mode (#341)
  - Root labels `Sub Agency` and `Sub-Agency` both normalize to `:tenant_sub_agency_ids`, so one root's IDs substitute for the other's (#375)
  - A lexical containment check lets a symlinked `tables/orders.md` write outside `tables/` (#181)
- **Tests: tests that can't fail, or new contracts with no test** (about 10):
  - `it.fails` records any exception from a helper as the known failure, so a spawn or fetch error shows `known` instead of `FAIL` (#383)
  - The AI SDK 6 smoke's `skipLibCheck` hides declaration incompatibilities it exists to catch (#196)
  - The HTTP API's `EADDRINUSE` exit path had no spawned test (#187)
- **Defects: lifecycle and failure paths** (about 6), concentrated in the consumer lab's scripts:
  - `lab:use` fails after rewriting `package.json`, and `fail()` exits before `main()` can roll back (#369)
  - The lab Postgres seeder runs before the advisory lock, so two concurrent runs race on DDL (#441)
  - The lab UI's signal handler closes only the HTTP server; an open database socket keeps the CLI alive (#442)
- **Spec: PR descriptions that contradict the diff** (about 5), mostly after a lower stacked PR changed design or a rebase changed the baseline:
  - The description promises `redactConnectionString` exports, but the diff ships parsed-part connection-label APIs (#189)
  - Reported matrix results predate a rebase that changed the lab baseline (#381)
  - A workflow gated on the whole Release run, while #255's acceptance criterion asks for every run that published (#443)
- **Standards: `AGENTS.md` conventions** (about 3):
  - Engine driver imports moved out of their `try` without a chained `.catch()` (#195)
  - Private packages advertised a Node floor below the development floor (#183, two comments)
- **Architecture: breaking public-surface changes under a patch changeset** (about 2):
  - Raised Node floors and restrictive `exports` maps shipped as patch (#183)
  - SQL Server connection strings with `{…}` change meaning under a patch (#189)

Also recurring, without a lens of their own:

- **The same defect at a sibling site:** review comments name repeats ("also appears on line …") at another call site, engine or doc, so after one finding, check the siblings (#444, #383, #187, #375).
- **Third-party semantics:** claims about Dependabot, GitHub and Changesets behaviour checked against vendor docs, such as `exclude-paths` applying to version updates only (#408) and a review payload missing `start_side` (#326).
- **Stacked-PR drift:** upper PRs' descriptions, ADRs and docs go stale when a lower PR changes design; the fix sometimes belongs in the lower PR (#189, #195, #199).

### Example comment

One review comment here that led to a fix, quoted, for its register:

> This new failure path runs after `package.json` has already been rewritten, and `fail()` exits the process before `main()` can call its rollback. If the block is misplaced, `lab:use` therefore reports failure but leaves the direct AskDB dependencies switched (reproduced with `askdb` changing from `old` to `1.0.0`). Validate the workspace block before writing either manifest, or make `pinTo` propagate an error that `main` rolls back. (#369)

## Verification commands

Commands the lenses run, and what "green" looks like (each exits 0):

- Build: `pnpm build` (CI `build`)
- Type-check and lint: `pnpm lint` (CI `lint`)
- All tests: `pnpm test` (CI `unit-node-matrix` and `test`; integration suites need the env vars under *Tests*)
- Packaging: `pnpm smoke:install`, `pnpm test:ai-floors`, `pnpm -r publish --dry-run --no-git-checks --access=public` (CI `preflight`)
- Dependency audit: `pnpm run audit` (CI `audit`)
- Changeset present: `pnpm changeset status --since=origin/main` (CI Changesets workflow)
- Docs site: `pnpm docs:build` and `pnpm -C apps/docs-site test` (build plus link check); CI runs them only on `main`
- Everything above in one go: `pnpm preflight`, which `AGENTS.md` asks for before a PR; it reinstalls dependencies, so run it only in a scratch worktree
- Consumer lab matrix: `pnpm lab:matrix` runs in CI's `consumer-lab` job (no `FAIL` cell is green); read its result with `gh pr checks <n>`, never run it locally (see *Guardrails*)

## Guardrails

- **Safe to run:** `pnpm lint` and a package's `tsc --noEmit`; focused package tests, including integration suites with `ASKDB_FIXTURE_HOST=127.0.0.1`, which read the multi-engine fixture; queries against the fixture as the read-only `fixture_reader` role; the SQLite fixture file, which belongs to the checkout; the consumer lab's focused tests (`pnpm lab:test <file>` or `pnpm lab:test -t '<scenario-id>'`, against the install already there; `tenant-rls` seeds the lab Postgres only when its dataset hash is stale, under an advisory lock); `pnpm lab ask`; writes to the lab's gitignored `.lab/` caches (`.lab/artifacts`, scratch projects); a server you start, poke and stop; `pnpm smoke:install` and `pnpm test:ai-floors`, which work in temp directories.
- **Out of bounds:** the multi-engine fixture's Postgres, MySQL, MariaDB and SQL Server containers and the consumer lab's own Postgres are shared with other worktrees and agents, so never run `pnpm fixture:up`, `fixture:reset`, `fixture:down`, `lab:up`, `lab:reset`, `lab:down`, `lab:matrix` (it runs `lab:up` first) or the lab's `postgres:up`, `postgres:down` and `postgres:reset`; `pnpm lab:use` in any form, `--restore` included, because it rewrites the lab's committed manifests; writes to the fixture's databases, which belong on a scratch copy (`lab_scratch_<token>`) or a second fixture copy from another worktree; and `docker compose down` on any fixture compose file, `pnpm pgvector:down` and `pgvector:reset` included. The `consumer-lab` skill's "Shared fixture guardrails" apply.

## Posting

- **Delivery:** a pending review left for a human to submit; `COMMENT` only on request; never approve or request changes.
- **Footer:** `Thread ID: <thread-uuid> (worktree <worktree-name>)`, the line `AGENTS.md` ("Conventions") asks for on PRs and issues; the worktree directory name is not the thread ID, so look the UUID up as `docs/agents/project-board.md` (**Thread lines**) describes.

## Stacked PRs

This repo stacks PRs occasionally, by hand or with `gh stack` (for example #189, #195 and #199, each based on the one before). Review each PR against its own base branch, reviewing only this layer. After a lower PR merges, changes or is restacked, re-check the upper PR's description, ADRs and docs against its new diff (#195, #199), and put a fix for a defect the lower layer introduced in the lower PR.
