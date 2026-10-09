# Architecture and public-release review — 2026-09-25

Reviewed at `26ca2bf` (`main`). Six parallel read-only reviews (AI layer, database layer, core SQL safety, product-surface security, release readiness, RAG/enrich/test quality), followed by fix PRs #180–#199. Every finding below was verified against the code before a PR was opened; bypasses were reproduced against the built `dist`.

> **Status as of 2026-09-29 (`main` @ `58fc8cd`).** The analysis below is as written on 2026-09-25. PR statuses, the merge order, and the findings register have since been updated to this date: 8 of the 20 review PRs have merged (#180, #191, #185, #194, #190, #186, #197, #192), and the follow-up plans that were drafted as `plans/053`–`071` are GitHub issues instead (`plans/` is closed to new plans; see `docs/agents/issue-tracker.md`). Anything still open is tracked on GitHub, not here.

## Verdict

The pipeline design is sound: `ask()` stays BYO-model and returns SQL, engine knowledge lives in integration packages, and the Schema v2 artifact is a good contract. What blocked a public release was not the architecture but three things:

1. **The safety story was overstated.** Docs said generated SQL is "parsed", that system schemas are rejected, and that AskDB "rewrites the query to guarantee the tenant filter". None of that was true. The validator was a quote-stripper plus a keyword denylist with concrete bypasses, and strict tenant mode could return unscoped SQL with `passed: true`.
2. **Studio was reachable from any web page.** No Host/Origin/CSRF protection, execute on by default, Postgres read-only escapable via the simple query protocol, and the setup wizard wrote unescaped strings into a TypeScript config it then evaluated (RCE when chained).
3. **CI never ran the database integration suites** (Turbo strict env mode dropped `DATABASE_URL` and friends), so every DB-backed claim was untested in CI.

## Architecture questions

### One package per LLM provider — no

The four `@askdb/ai-*` packages each wrapped 25–120 lines of provider *data* (env names, default model, factory call, reasoning mapping) in a full npm package. The split delivered no install savings — CLI, HTTP API and Studio eagerly registered all four — while costing four release units, a provider list enumerated in 9+ places (already drifted: `ASKDB_AI_PROVIDERS` lacked `anthropic`), and peer-dependent major bumps (adapters jumped `0.1.0-beta.2 → 1.0.0-beta.3`). Mock-only tests also hid real bugs (Azure embeddings silently dropped `dimensions`).

**Recommendation, proposed in #198 (open; it amends ADR 0006 to Option E, and #196, also open, amends ADR 0006 too):** one `@askdb/ai` with built-in providers loaded lazily and `@ai-sdk/*` as optional peers; a single provider table; `createAiRegistry()` defaults to built-ins; the `gateway` provider (bundled with `ai@7`) is added for free; the four packages become deprecated re-export shims, to be removed before 1.0. `AiProviderAdapter` stays the third-party extension point.

`@askdb/ai` should be positioned narrowly — "turn `askdb.config` into a model" — not as a general app model factory: it is key-centric and cannot express IAM/ADC/Entra/local-model auth. Hosts with an AI stack should pass a `LanguageModel`, an AI Gateway string, or their own `createProviderRegistry`. `ai@7` also has a portable top-level `reasoning` option that providers map natively; AskDB's hand-maintained reasoning regexes should migrate to it (follow-up: #344).

Separately, `@askdb/core` hard-depended on `ai`, pinning consumers' AI SDK major (a real consumer is stuck on `beta.40` with `ai@6`). **PR #196** (open) makes it a peer (`^6 || ^7`) and switches to the `system` key, which both majors accept — this also fixes a silent bug where `ai@6` hosts got no system prompt.

### One package per database — yes, but with a shared kit and an open registry

Per-engine packages are the right boundary (optional peer drivers, engine-specific catalog SQL, independent release). Dialects already moved into `@askdb/core` (`dialect-spec.ts`), so a separate `@askdb/dialects` package would add nothing. What hurt:

- Roughly 600–700 duplicated lines across the engines (byte-identical `glob.ts`/`ids.ts` ×5, driver loader ×4, FK/unique/index builders ×3–4). **PR #195** (open) extracts `@askdb/introspect/kit`.
- `@askdb/connectors` was a map lookup over a *closed* provider union — third parties could not add an engine, contradicting ADRs 0002/0007 — and the CLI and Studio still kept per-engine connection switches. **PR #199** (open) moves the registry into `@askdb/introspect` with open provider ids and a `resolveConnection` hook, deletes both switches, deprecates `@askdb/connectors`, and records ADR 0008.

Follow-ups: session-scoped catalog runner (one connection, snapshot, timeout) instead of a new pool per query (#348); the renderer drops comments, enum labels and composite-FK grouping that connectors already compute (needs a Schema v2 minor; #349).

## What AskDB guarantees now (after the PRs)

AskDB's guardrails are **defense in depth, not a security boundary**. After #190/#186/#197: a dialect-aware lexer (E-strings, exact `$tag$`, backslash rules, `#` comments, brackets only on SQL Server; unterminated tokens rejected), a single statement starting with `SELECT`/`WITH`, keyword and per-dialect function denylists (incl. `INTO`, `OUTFILE`, `set_config`, `dblink_exec`, T-SQL batch verbs), sensitive-column detection including `*`/`t.*`/whole-row functions, and tenant checks that run on the SQL actually returned, for every dialect, failing closed on malformed policies. The host must still execute with a least-privilege read-only role, enforce tenancy in the database (RLS), and set timeouts. #184 (open) rewrites the docs to say exactly this.

#190, #186 and #197 have merged, and they closed the bypasses this review reproduced. They did not close every bypass of these guardrails. Issues filed against `main` since then report remaining gaps, and they belong in this list until they are fixed:

- Sensitive-column check: misses a parenthesized FROM item (#306), a comma join after a JOIN's `ON`/`USING` (#307), MySQL `STRAIGHT_JOIN` (#308), and Postgres `TABLE` shorthand in a derived table (#309).
- Read-only check: SQL Server `WITH (UPDLOCK)` passes, while `FOR UPDATE` is rejected on the other engines (#319).
- Validator: a truncated, syntactically incomplete statement passes as validated (#314).
- Tenant check: strict mode still returns SQL whose filter doesn't filter (a column only selected, the wrong tenant, `OR 1 = 1`, an unfiltered root table), because the check is a presence test (#315; the rewriting spike is #235).
- Tenant binding: a `subtree` scope over a hierarchy of different root tables binds descendant-level IDs under the root's placeholder, which leaks rows across tenants (#338, in #270's unreleased expansion).

## PR map and merge order

Independent PRs off `main` can merge in any order. Stacked PRs are GitHub native stacks (`gh stack`); merge them bottom-up, and GitHub rebases and retargets the layers above automatically. The review opened four stacks: #185→#194, #186→#197→#192, #188→#198, and #189→#195→#199. The first two have fully merged (#192 was retargeted to `main` before it merged). Two are still stacked: **#188→#198** and **#189→#195→#199**. #191 was based on #180 and merged after it. Expected conflicts are small: `pnpm-lock.yaml` (re-run `pnpm install`), ADR 0006 amendment tail (#196 vs #198), LICENSE/NOTICE added identically by #182 and #183, and docs pages touched by #184 plus a feature PR.

The table is the order the review recommended. The Status column is as of 2026-09-29.

| Order | PR | Base | Area | Why it matters | Status |
|---|---|---|---|---|---|
| 1 | #180 | main | CI | Integration suites actually run; fail-on-skip | Merged 2026-09-25 |
| 1a | #191 | #180 | CI | lint/audit jobs, Node 22.12/24 matrix, SHA pins, least privilege, Dependabot; fixes a critical Astro advisory via lockfile | Merged 2026-09-25 |
| 2 | #185 | main | Studio | Host/Origin/token guard; config-injection (RCE) fix | Merged 2026-09-25 |
| 2a | #194 | #185 | Studio | Execute opt-in, single-statement read-only, timeouts, row caps | Merged 2026-09-27 |
| 3 | #186 | main | core | Tenant enforcement fails closed (returned SQL, custom dialects, malformed policy) | Merged 2026-09-27 |
| 3a | #197 | #186 | core | Tenant binding: dialect markers, fail-closed placeholders, operators, literal-injection; drop `tenantFilters`; fail closed on an unexpanded `subtree` in `resolveTenantSql` (#270 added the expansion itself) | Merged 2026-09-28 |
| 3b | #192 | #197 | core | Front-matter sensitivity (Studio) actually takes effect, escalate-only | Merged 2026-09-29 |
| 4 | #190 | main | core | Dialect-aware lexer; closes the read-only and sensitive-column bypasses this review reproduced (later gaps: #306–#309, #314, #319) | Merged 2026-09-27 |
| 5 | #184 | main | docs | Safety claims made accurate; "run generated SQL safely" guidance; SECURITY.md model | Open |
| 6 | #181 | main | enrich | Bundles keep `tenant-policy.md` (tenant isolation was silently lost) | Open |
| 7 | #187 | main | http-api | Typed error mapping (502 was dead code), config sensitivity floor, schema override gated | Open |
| 8 | #189 | main | introspect | `--diff` correctness, partition/SQLite/MySQL FK fixes, password redaction | Open |
| 8a | #195 | #189 | introspect | Shared engine kit; ~600 duplicated lines removed from the engine packages | Open (stacked on #189) |
| 8b | #199 | #195 | introspect | Registry into introspect, open ids, ADR 0008 | Open (stacked on #195) |
| 9 | #188 | main | ai | Azure/Google embedding options, reasoning detection, Azure config, real-SDK contract tests | Open |
| 9a | #198 | #188 | ai | Fold adapters into `@askdb/ai` (ADR 0006 amendment) | Open (stacked on #188) |
| 10 | #196 | main | core | `ai` as peer (`^6 || ^7`) | Open |
| 11 | #193 | main | rag | Store-verified incremental indexing, schema-scoped ids, sensitive filtering | Open |
| 12 | #183 | main | release | LICENSE/NOTICE in every tarball + smoke assertion, Node ≥22.12, trimmed install footprint | Open |
| 13 | #182 | main | cli | `--help`/`--version` without config; README accuracy | Open |

**Actual merge order so far:** #180 (2026-09-25 16:36 UTC), #191 (09-25 17:32), #185 (09-25 21:01), #194 (09-27 20:17), #190 (09-27 21:50), #186 (09-27 22:23), #197 (09-28 18:14), #192 (09-29 00:37). It differs from the table: #194 and #190 merged before #186. Related work merged outside this set: #270 (`subtree` expansion, 09-27 20:13) and #276 (root config no longer imports `dotenv`, 09-27).

**Composition verified at #201's head `c7404d4` (2026-09-25):** draft PR #201 merged all of the above onto #191 and was green in CI with the real Postgres/Pagila, MySQL, SQL Server, SQLite and pgvector suites. Its description has the per-file conflict resolutions and seven small composition fixes (five in the first pass, two more in its test-audit refresh; e.g. #192's chunk-id test vs #193's new id format; passing the dialect through `ask()`'s guardrails once #190 lands; #183's lazy Prisma import vs #199's registry) to apply while merging. Do not merge #201 itself. #201 hasn't been updated since `c7404d4`, and #186, #190, #192 and #197 gained follow-up commits after it and before they merged, so its fix list can predate the code now on `main`: check each fix against `main` rather than assuming it applies unchanged (#358).

#180 merged first, so every later PR's CI run exercises the real databases. PRs opened before it (notably #189's partition-FK and #193's pgvector tests) should be re-run after rebasing.

## Maintainer actions (not doable from a PR)

The leaked key, repo settings and stale branches are tracked in #355; the release pipeline and versioning in #354; the dist-tags in #267.

- **Leaked key:** an `sk-proj-` key committed to `.env.example` (e.g. `5e20605`) is still reachable from ~53 stale remote branches. Confirm it is revoked in the OpenAI console; prune the branches.
- **Repo settings:** done since this review (ruleset on `main` with 8 required checks, push protection, Dependabot security updates, read-only default `GITHUB_TOKEN`). Still open, tracked in #355: SHA-pinned Actions required at the repo level, the repo description and topics, delete-head-branches-on-merge, and the code-of-conduct contact.
- **npm dist-tags:** `beta` points at stale `0.5.0-beta.*`; `latest` points at prereleases.
- **PR #179 (release automation):** the version PR opened with `GITHUB_TOKEN` will not trigger `ci.yml`, so the claimed CI gate does not hold. Use a GitHub App token; split version (no npm credentials) and publish (protected environment, `has-changesets == 'false'`) jobs; npm trusted publishing (OIDC); SHA-pin `changesets/action`.
- **Versioning:** commit to the 1.x line (npm already has `1.0.0-beta.*`). Before GA, land the breaking changes still in prerelease (#196, #198 and #199, all open; #197's `tenantFilters` removal has merged), then consider `"fixed": [["askdb", "@askdb/*"]]`, `privatePackages: { version: false }`, and `pre enter rc`. #198 turns on `onlyUpdatePeerDependentsWhenOutOfRange` to stop spurious peer-major bumps — keep or drop that commit deliberately.
- **Internal files:** `plans/`, `thunder-tests/`, `.claude/settings.local.json`, `skills-lock.json` are public in the repo. Since 2026-09-26, `plans/` holds only implemented plans, as history, and open work lives in GitHub issues. The rest is a maintainer decision (issue #368).
- **`AGENTS.md`** lines about `@askdb/ai-*` peer adapters become stale once #198 merges.

## Deferred (recommended next)

Each item below is tracked as a GitHub issue. The post-review deltas on plans 038, 039, 042, 043, 047, 049 and 050 (issues #224–#235) are in the [appendix](#appendix-post-review-deltas-for-plans-that-moved-to-github-issues). Start with #358 once the review PRs have merged.

- Plan 046 step 5: default `tenantSqlMode` to `sql-params` (#231).
- Plan 047 (#232): real `subtree` descendant expansion. #270 implemented it (merged 2026-09-27) with a host resolver, `resolveTenantDescendants`, whose result `ask()` folds into an `ids` scope for the same root; #268 tracks a built-in recursive-CTE alternative. The multi-table-hierarchy critique in the [plan 047 appendix](#plan-047-232-make-subtree-tenant-access-actually-include-descendants) holds for #270: in a hierarchy across different root tables, a resolver that returns descendant-level IDs gets them bound under the root's placeholder, and rows leak across tenants. That is #338 (P1, unreleased); the review's per-root expansion (drafted as plan 054) is its option 1.
- Plan 049 (#234): document database-level tenant enforcement (RLS) as the primary path — note that `set_config` must stay blocked since RLS keyed on a GUC is otherwise defeatable.
- Plan 050 (#235): deterministic tenant predicate rewriting (the tenant check is still a presence test; `... OR 1=1` passes; see also #315).
- Plan 038 (#224): **declined** on 2026-09-27 (`wontfix`: AskDB returns SQL and never executes it, and capping the rows a query returns is part of executing it). The docs side, a row-cap recipe that is wrong on SQL Server and MariaDB, is #266.
- Migrate reasoning effort to `ai@7`'s native `reasoning` option (#344).
- Provider-neutral RAG embedder config (Studio asks Google for an OpenAI embedding model today) (#345).
- Move `askdb-rag` into `askdb rag` and drop `@askdb/rag`'s dependency on `@askdb/config` (#346).
- Split `apps/studio/src/server.ts` (~1.9k lines) and `apps/cli/src/init.ts` (~1.1k lines); merge the duplicated config renderers in `init.ts` and Studio `setup.ts` (#353).
- Renderer: composite FKs, enum labels, comments (Schema v2 minor) (#349).
- Deeper MySQL/SQL Server/SQLite integration fixtures (views, composite FKs, multi-schema): mostly delivered by #219 and #220 (merged; the shared multi-engine fixture and golden); the remaining connector facts are #350.
- The HTTP API cannot serve tenant-scoped schemas (no way to pass a scope): #343 (the server-side `resolveTenantScope` hook, blocked by #187) and #277 (a scope for the `askdb-http` binary and `askdb ask`).
- The rest of the drafted follow-ups: #342 (tenant guardrail on the shared lexer), #347 (remove the deprecated shims), #348 (session-scoped catalog runner), #351 (lift partition-leaf FKs), #352 (Studio strict sensitive mode), #356 (dead code and unused exports), #357 (test-audit follow-ups). The findings register's previously untracked rows are #359–#368.

## Findings register

Every finding from the six review lanes, with a stable ID. PR descriptions cite the lane-local ID (for example **C1** in #185, **F2** in #186); the prefixed form below is the unambiguous one, because each lane numbered its findings independently (security **C1** ≠ RAG **C1**). Severity letter: **C** critical, **H** high, **M** medium, **L** low; the release lane uses **B** blocker, **S** should-fix; the core lane numbered its findings **F1–F12**.

Status, as of 2026-09-29: **#N (merged)** means fixed on `main` by that PR. **#N (open)** means the fix is in that PR, which hasn't merged, so the finding still holds on `main`. **issue #N** means the work is tracked in that issue. Every row that isn't fully fixed on `main` points at an open PR or an issue.

### SEC — product surfaces security (Studio, HTTP API, CLI)

| ID | Finding | Status |
|---|---|---|
| SEC-C1 | Studio API had no Host / Origin / CSRF check; any web page (or DNS rebinding) could call `/api/execute` or rewrite schema files | #185 (merged; ADR 0009) |
| SEC-C2 | Setup wizard wrote unescaped values into `askdb.config.ts`, which Studio then executes → code injection | #185 (merged) |
| SEC-H1 | Studio "read-only" execute bypassable (pg simple-protocol multi-statement, no SQL Server guard, no `validateSelectSql`) | #194 (merged); SQL Server structural single-statement guard: issue #327 |
| SEC-H2 | Studio execute always on and silently reused introspection credentials | #194 (merged) |
| SEC-H3 | Most mutating Studio endpoints skipped the loopback gate | #185 (merged; token on every `/api/*`) |
| SEC-M1 | HTTP API ignored config `modes.omitSensitiveFromPrompt` | #187 (open) |
| SEC-M2 | HTTP API classified errors by substring (`"mode"` matched "Model"), so 502 was dead code | #187 (open); reported live on `main` in issue #299 |
| SEC-M3 | Studio execute had no statement timeout or real row cap | #194 (merged) |
| SEC-M4 | Unbounded Studio request bodies; Playground history persisted arbitrary input | #194 (merged) |
| SEC-M5 | HTTP API always accepted per-request `schemaJson`; no LLM timeout | #187 (open) |
| SEC-L1 | Studio install-driver: `"constructor"` accepted; `spawn("pnpm")` broken on Windows | #194 (merged) |
| SEC-L2 | `askdb init` wrote unvalidated values into TypeScript; renderer duplicated with Studio | #185 (merged; escaping); single renderer: issue #353 |
| SEC-L3 | HTTP API printed a raw stack on startup errors | #187 (open) |
| SEC-L4 | Security docs inaccurate (SECURITY.md, architecture, Studio page) | #184 (open), #185 (merged) |

### CORE — core pipeline and SQL safety

| ID | Finding | Status |
|---|---|---|
| CORE-F1 | Read-only validator bypassable: quote stripper disagreed with the databases (E-strings, `$tag$`, backslashes, `#`) | #190 (merged); later gaps: issues #314, #319 |
| CORE-F2 | Strict tenant check ran on the unbound SQL, not the SQL returned | #186 (merged) |
| CORE-F3 | Malformed `tenant-policy.md` silently disabled tenancy; `schema.json` path skipped the policy | #186 (merged) |
| CORE-F4 | Tenant check is a presence test (`… OR 1=1` passes) | #184 (open; docs); #197 (merged; code regions only); lexing: issue #342; still live on `main`: issue #315; rewriting spike: issue #235 |
| CORE-F5 | Custom `AskDialect` skipped tenant enforcement | #186 (merged) |
| CORE-F6 | Denylist gaps: `SELECT INTO`, `OUTFILE`, `set_config`, `dblink_exec`, T-SQL batch verbs | #190 (merged) |
| CORE-F7 | Sensitive check missed `*`, `t.*`, whole-row functions | #190 (merged); later gaps: issues #306–#309 |
| CORE-F8 | Tenant binding: wrong markers, fail-open placeholders, `!=` corruption, literal injection | #197 (merged) |
| CORE-F9 | `subtree` scope never expanded descendants | #270 (merged; host resolver `resolveTenantDescendants`, folded into an `ids` scope); #197 (merged; `resolveTenantSql` fails closed on an unexpanded `subtree`); built-in recursive CTE: issue #268; cross-tenant leak in multi-table hierarchies (the plan 047 appendix's critique): issue #338 |
| CORE-F10 | `tenantFilters` documented but never read | #197 (merged; removed) |
| CORE-F11 | Parameterize consistency check lowercases literals, so `params` can drift from `sql` | issue #359 |
| CORE-F12 | Custom dialects escape tenant IDs without backslash handling | issue #360 |
| CORE-F13 | Tenant guardrail fail-opens on MySQL strings and uppercase placeholders (found while writing plan 055) | #197 (merged; `886670c`, and its last review round also fixed the Postgres `E'…'` case, pinned in `tenant-guardrail.test.ts`); scanner rebuild on the shared lexer: issue #342 |

### DB — database integration layer

| ID | Finding | Status |
|---|---|---|
| DB-C1 | Studio `/api/execute` ran any SQL from any requester | #185 (merged) + #194 (merged) |
| DB-H1 | `validateSelectSql` bypasses (dialect lexing, denylists) | #190 (merged) |
| DB-H2 | `askdb introspect --diff` almost always reported "changed" | #189 (open) |
| DB-M1 | Renderer drops composite FKs, enum labels, comments | issue #349 |
| DB-M2 | Postgres FKs cloned onto partitions rendered to leaves | #189 (open); lift to parent: issue #351 |
| DB-M3 | SQLite FK without target column pointed at the source column | #189 (open) |
| DB-M4 | Catalog runners open a connection per query; no snapshot or timeout; pool leak on connect failure | issue #348 |
| DB-M5 | Studio showed SQL Server passwords in connection labels | #189 (open) |
| DB-M6 | Engine filter inconsistencies; MySQL URL without a database returned an empty schema | #189 (open; MySQL error); filter warnings: issue #361 |
| DB-L1 | SQLite `NOT LIKE 'sqlite_%'` dropped user tables | #189 (open) |
| DB-L2 | SQLite index-origin comment inverted | #189 (open) |
| DB-L3 | Catalog coverage: MySQL cross-database FKs, SQL Server `is_ms_shipped`, Postgres extension schemas | #189 (open; first two); extension schemas: issue #362 |
| DB-L4 | Package hygiene: unused http-api deps, Studio driver peer ranges, eager Prisma | #189, #183, #199 (all open) |
| DB-L5 | Docs drift in ADR 0007, architecture, connectors guide | #189, #199 (both open) |
| DB-A1 | Architecture: ~600 duplicated engine lines; closed connector registry | #195 (open; engine kit), #199 (open; registry, adds ADR 0008) |

### AI — AI provider layer and config

| ID | Finding | Status |
|---|---|---|
| AI-H1 | HTTP API returned model failures as 400 with raw provider text (same root cause as SEC-M2) | #187 (open); reported live on `main` in issue #299 |
| AI-H2 | Azure embeddings silently dropped `dimensions` / `user` | #188 (open) |
| AI-H3 | Reasoning-model detection stale / duplicated AI SDK 7 | #188 (open; tables); native `reasoning`: issue #344 |
| AI-M4 | Config-driven Azure failed: no `resourceName` in config | #188 (open) |
| AI-M5 | Provider error text returned to HTTP clients | #187 (open) |
| AI-M6 | Google embeddings ignored `dimensions`; deprecated method | #188 (open) |
| AI-M7 | RAG `ai-sdk` embedder effectively OpenAI-only; OpenAI key sent to the selected provider | issue #345 (P1) |
| AI-M8 | Provider list enumerated in 9+ places and drifted | #188, #198 (both open) |
| AI-M9 | `ai` was a hard dependency of core | #196 (open) |
| AI-L10 | Wrong install hint for aliases / custom providers | #188, #198 (both open) |
| AI-L11 | `as unknown as` / `as any` type holes in client and Studio | issue #363 |
| AI-L12 | ADR 0005's env-override allowlist never implemented; messages say "set ASKDB_MOCK_SQL" | #187 (open; http-api message); CLI/Studio messages: issue #281 |
| AI-L13 | Docs miss AI Gateway strings and `createProviderRegistry` | issue #228 (plan 042, rescoped) |
| AI-L14 | Studio duplicates client model/reasoning resolution; tenant suggestion ignores reasoning effort | issue #364 |
| AI-A1 | Architecture: four `@askdb/ai-*` packages for provider data | #198 (open; ADR 0006 amendment); remove shims: issue #347 |

### REL — public release readiness

| ID | Finding | Status |
|---|---|---|
| REL-B1 | Safety and tenancy docs overclaimed | #184 (open); remaining overclaims: issue #283 |
| REL-B2 | Eight packages shipped without LICENSE/NOTICE | #183, #182 (both open) |
| REL-B3 | Node engine range inconsistent (20 vs 22 vs 22.12) | #183 (open), #191 (merged) |
| REL-B4 | `askdb --help` / `--version` crashed outside a project; root config imported `dotenv` | #182 (open; `--help`/`--version`); root config `dotenv`: #276 (merged) |
| REL-B5 | npm dist-tags wrong (`beta` stale, `latest` on prereleases) | issue #267; issue #354 (human steps) |
| REL-S1 | Release workflow: long-lived token, no environment, no branch guard | issue #354 |
| REL-S2 | PR #179: version PR opened with `GITHUB_TOKEN` never triggers CI | issue #354 (#179 open) |
| REL-S3 | CI gaps: no lint/audit jobs, missing permissions, unpinned actions | #191 (merged) |
| REL-S4 | Changesets config causes surprise major bumps | #198 (open; peer option); issue #354 |
| REL-S5 | Large install footprint (Studio UI deps, eager Prisma) | #183 (open) |
| REL-S6 | Leaked key still reachable from stale branches and tags | issue #355 (human) |
| REL-S7 | README inaccurate (status, links, package list) | #182 (open) |
| REL-S8 | Internal files at repo root (`plans/`, `thunder-tests/`, `.claude/settings.local.json`, `skills-lock.json`) | issue #368 (maintainer decision) |

### RAG — RAG, enrich, and test quality

| ID | Finding | Status |
|---|---|---|
| RAG-C1 | CI never ran the database integration suites (Turbo strict env) | #180 (merged) |
| RAG-C2 | `askdb bundle` dropped `tenant-policy.md` | #181 (open) |
| RAG-H1 | Studio sensitivity overrides had no effect | #192 (merged) |
| RAG-H2 | Indexer trusted the lock file over the store | #193 (open) |
| RAG-H3 | Chunk IDs not schema-scoped; cross-schema orphan deletion | #193 (open) |
| RAG-M1 | Sensitive prose checks case-sensitive and incomplete | #193 (open) |
| RAG-M2 | Enrich table filenames collide / can escape `tables/` | #181 (open) |
| RAG-M3 | RAG CLI dimension handling inconsistent | #193 (open) |
| RAG-M4 | `@askdb/rag` depends on `@askdb/config` only for its CLI | issue #346 |
| RAG-M5 | Malformed `concepts.md` silently ignored | #186 (merged) |
| RAG-M6 | File store writes not atomic | #193 (open) |
| RAG-M7 | Studio skips sensitive-mention warnings and orphan pruning | issue #365 |
| RAG-M8 | CLI tests raced on the build output | #180 (merged) |
| RAG-L1 | pgvector setup: silent dimension mismatch, `ensureSchema` on every status call | #193 (open; mismatch); status-call cost: issue #366 |
| RAG-L2 | pgvector loaded `pg` with a bare import | #193 (open) |
| RAG-L3 | RAG docs drift | #193 (open) |
| RAG-L4 | Test files never typechecked by `lint` | issue #367 |
| RAG-L5 | `test` depended on `^test`, serializing runs | #180 (merged) |

## Appendix: post-review deltas for plans that moved to GitHub issues

On 2026-09-26, after this review was written, plans 035–052 moved to GitHub issues and their files were deleted from `plans/` (see `plans/README.md`). The review had appended a `Post-review delta (2026-09-25)` section to seven of those plans, and updated their **Depends on** lines. They are kept here so the deltas survive the move: the delta text is as written on 2026-09-25, with dated status notes added and one section trimmed where it no longer applied. Read each one together with its issue.

Two notes as of 2026-09-29. First, the deltas cite follow-up plans 053–071, which are GitHub issues instead of files: 053 → #231 (it was that issue's step 5), 054 → to be rescoped as #338's option 1, 055 → #342, 056 → #343, 057 → #344, 058 → #345, 059 → #346, 060 → #347, 061 → #348, 062 → #349, 063 → #350, 064 → #351, 065 → #352, 066 → #353, 067 → #354, 068 → #355, 069 → #356, 070 → #357, 071 → #358. Second, plan 054 (per-root `subtree` expansion) is not filed as its own issue: #270 implemented `subtree` expansion first (see the plan 047 section), the critique below holds for it (#338), and plan 054 is to be rescoped onto #270's API as #338's option 1. Read the "if plan 054 has landed" remarks in the 049 and 050 sections as "if #338's option 1 has landed".

### Plan 038 (#224): Ship a dialect-aware row-limit helper and a documented safe-execution recipe

> **Status (2026-09-29): declined.** #224 was closed as `wontfix` on 2026-09-27: "AskDB returns SQL and never executes it, and capping how many rows a query returns is part of executing it." Don't execute this delta. The docs side (the row-cap recipe in `run-safely-in-prod`, which fails on SQL Server and drops `ORDER BY` on MariaDB) is #266; the SQL Server and MySQL findings below are useful input for it.

**Depends on** (updated 2026-09-25): #194 (for the Studio migration step added in the post-review delta; the core helper itself has no dependency)

Checked against `review/integration-check @ c7404d4` (main plus review PRs #180–#205). At the time, the plan was still TODO and judged worth doing. Studio shipped its own row cap in the meantime, and that work showed the SQL Server design here is wrong. Apply these changes before executing.

**What landed (#194, Studio execute hardening):**
- `apps/studio/src/execute-registry.ts` now has its own exported `wrapWithRowLimit(sql: string, fetchLimit: number)`, which returns ``SELECT * FROM (\n${sql}\n) AS askdb_q LIMIT ${fetchLimit}``, plus a private `ROW_LIMIT_ALIAS = "askdb_q"`. It's used for Postgres and MySQL. Runners fetch `maxRows + 1` and report `truncated` / `rowLimit` (`buildOkResponse`). #194's PR notes say it was written as a stand-in for this plan's core helper.
- **SQL Server doesn't use a derived-table wrap.** `buildSqlServerBatch(sql, fetchLimit)` uses `SET ROWCOUNT n` inside an always-rolled-back transaction, because wrapping in a derived table rejects unnamed columns such as `COUNT(*)` (every derived-table column needs a name). Step 1's `SELECT TOP (n) * FROM (<sql>) AS askdb_result` has the same flaw. **Don't ship it as-is.** Either (a) return a strategy result for `sqlserver` (e.g. `{ kind: "rowcount", prefix: "SET ROWCOUNT n;", suffix: "SET ROWCOUNT 0;" }` or equivalent) instead of a single wrapped string, or (b) document that the SQL Server wrap requires named columns and make the helper refuse unnamed ones. You can't detect unnamed columns reliably without a parser, so prefer (a). Record the choice in the PR.
- SQLite in Studio doesn't wrap at all. It stops `.iterate()` at the cap.
- **MySQL duplicate column names.** The `SELECT * FROM (…) AS alias` wrap fails on MySQL when the inner query returns two columns with the same name (e.g. `SELECT a.id, b.id …`), because MySQL rejects duplicate column names in a derived table. Studio documents this (`apps/docs-site/src/content/docs/studio.mdx`, "Row cap" bullet: "a MySQL query that returns two columns with the same name needs aliases"). The core helper's JSDoc and docs must say the same for `mysql`/`mariadb`, and a test should pin the documented shape rather than pretend it works.
- Alias: Studio uses `askdb_q`, and so does the public docs snippet in `apps/docs-site/src/content/docs/guides/run-safely-in-prod.mdx` ("Row limits": ``const cappedSql = `SELECT * FROM (${sql}) AS askdb_q LIMIT 1000`;``). Use `askdb_q` for `ROW_LIMIT_SUBQUERY_ALIAS` instead of `askdb_result` so the shipped shapes don't churn.

**Docs moved (#184):** `apps/docs-site/src/content/docs/concepts/safety-boundaries.mdx` now has a "Run generated SQL safely" section, and `guides/run-safely-in-prod.mdx` has "Database role", "Connection limits" and "Row limits" sections. Step 4's recipe should update those public pages: replace the hand-written wrap in "Row limits" with the helper. Keep `docs/integration/executing-generated-sql.md` only if it adds something beyond them. `docs/specs/studio.md` has a verified per-engine table (read-only transaction, timeout, and row-cap mechanism for Postgres/MySQL/SQL Server/SQLite). Reuse it for Step 4's per-engine notes instead of re-deriving syntax.

**Stale references:** the `remediationNote` wording (Step 4 item 5) now reads "Heuristic, lexer-based defense-in-depth checks only—not a SQL parser and not a security boundary. Execute generated SQL under a read-only database role, and review it before trusted execution." (`packages/core/src/sql/validate.ts`, `buildSelectGuardrailExplanation`). `DialectSpec` has since gained `blockedFunctions`, `listBinding`, and `backslashEscapes`, but the "don't add `rowLimitStrategy`" out-of-scope note still applies.

**New step after Step 3 (the Studio migration is now in scope):** switch `apps/studio/src/execute-registry.ts` to the core helper. Delete Studio's `wrapWithRowLimit` and `ROW_LIMIT_ALIAS`, call the core export for Postgres and MySQL, and route SQL Server through the core strategy if (a) was chosen (otherwise keep `buildSqlServerBatch`). Update the two exact-string assertions in `apps/studio/src/execute-registry.unified.test.ts` (`"SELECT * FROM (\nSELECT 1\n) AS askdb_q LIMIT 501"`) only if the shape changes, and keep them asserting the exact SQL. Add `apps/studio/src/execute-registry.ts`, its unified test, and a `@askdb/studio` patch changeset to the in-scope list. Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`) to all new tests: `packages/core/src/sql/row-limit.test.ts` is the primary owner of the wrap shapes, and Studio's tests only keep asserting that the runners use it.

**Readiness check (replaces the drift check):** `gh pr view 194 --repo Ygilany/AskDB --json state -q .state` → `MERGED`; `git grep -n 'export function wrapWithRowLimit' -- apps/studio/src/execute-registry.ts` → 1 match; `git grep -n 'wrapWithRowLimit' -- packages/core/src` → no matches (still not done).

### Plan 039 (#225): Give `askdb introspect` a `--check` mode that fails CI on schema-artifact drift

**Depends on** (updated 2026-09-25): PRs #189 (`--diff` correctness via `renderSchemaV2Body`) and #199 (registry-based engine dispatch) merged — see "Post-review delta (2026-09-25)" at the end of this file

Verified against `review/integration-check @ c7404d4` (origin/main plus review PRs #180–#205). **Read this section before the body.** Where the two disagree, this section wins. The goal, the exit-code contract (`0` up to date, `1` error, `2` drift), and the rule that `--check` is a modifier on `--diff` (not a fourth output mode) are unchanged.

#### Why the plan was stale, and what changed

- **#189 fixed `--diff` itself.** Before it, `--diff` compared against `toV2SchemaJson(result.schema, schemaId)`, which dropped the `provider` field that `--out` writes and skipped the ID-anchored merge. So `--diff` reported `changed: true` against almost any artifact, and a `--check` built on it would have failed every CI run. That is the STOP condition "`changed: true` for a freshly generated, unmodified artifact", and it was real. #189 added `renderSchemaV2Body(schema, { schemaId, provider?, existingArtifactDir? })` in `packages/introspect/src/render/render.ts`. It is the one pure function that `--out`, `--print` and `--diff` all use. `--diff` now merges with the existing artifact (so human-set `sensitive` flags are not drift) and compares ignoring key order. **This plan now depends on #189**, and that STOP condition is resolved. Keep it as a regression guard only.
- **#199 moved engine dispatch into the connector registry.** `apps/cli/src/introspect.ts` has no per-engine `if (engine === …)` block any more. `runIntrospectCommand` calls `resolveEngine(registry, …)`, then `registry.resolveConnection(engine, { explicit, runtime: rt, surface: "cli" })`, then `registry.createConnector(connectorConfig)`. `runIntrospectCli(argv, { connectorRegistry })` accepts an injected registry (default `defaultConnectorRegistry`). This does not change what `--check` must do, but it gives Step 5 a much better test harness (below).

#### Updated "Current state" references (c7404d4, `apps/cli/src/introspect.ts`)

- `CliOptions` declares `diff?: string;` (around line 64). Add `check?: boolean;` next to it.
- The parser `case "--diff": opts.diff = readValue(argv, ++i, arg); break;` is in `parseOptions` (around lines 306–308).
- Output-mode handling is now at lines 138–148, and there is a **new first block**: `if (!opts.print && !opts.diff && !opts.out) { opts.out = rt.introspection.outputDir; }`. So a bare `askdb introspect --check` (no `--diff`) would otherwise be defaulted into `--out` mode, or would fail with the generic "Provide one output mode" error when no `outputDir` is configured. Put the `--check requires --diff <existing-dir>.` validation **before** that defaulting block, so the user always gets the specific message.
- `runWithOutput(runConfig, opts, schemaId)` (lines 209–257) still has exactly three return sites: `--print` (217–225), `--diff` (227–245), `--out` fall-through (247–256). There is one call site, `const result = await runWithOutput(runConfig, opts, schemaId);` (line 183). Step 2's "three return sites + one call site" budget still holds.
- The `--diff` branch now reads:
  ```ts
  const rendered = renderSchemaV2Body(result.schema, {
    schemaId,
    provider: result.provider,
    existingArtifactDir: hasExisting && isV2SchemaFile(existingPath) ? opts.diff : undefined,
  });
  const existing = hasExisting ? readFileSync(existingPath, "utf8") : "";
  const changed = rendered.body !== existing && !sameJson(existing, rendered.json);
  process.stdout.write(`${JSON.stringify({ changed, schemaJsonPath: existingPath }, null, 2)}\n`);
  ```
  Thread **this** `changed` value out. Do not recompute it. The stdout JSON shape `{ changed, schemaJsonPath }` must stay byte-identical. A missing `schema.json` yields `changed: true`, which `--check` should report as drift (exit 2) with a message that says the artifact does not exist.
- The unconditional `return 0` after the `completed` log is now around line 199. The warnings loop is at 184–189, and `result.warnings` now includes the render warnings (`new_column`, `orphan_id`) because both `--print` and `--diff` append `rendered.warnings`.
- `printHelp()` is at lines 396–434. The `--diff` usage lines are `askdb introspect --engine prisma --prisma-schema <…> --diff <existing-dir>` and `askdb introspect --from-export <bundle-dir> --diff <existing-dir>`.

#### Step changes

- **Steps 1–4**: still valid, with the line references above and the ordering fix for the `--check requires --diff` validation in Step 1.
- **Step 5 (tests)**: prefer in-process tests through the injected registry over spawning the CLI with `--from-export`. `apps/cli/src/introspect-registry.test.ts` already shows the pattern: `setAskDbRuntimeForTests(…)`, a fake `ConnectorProviderAdapter` (`acmeAdapter()`) whose connector returns a fixed `IntrospectionResult`, and `runIntrospectCli([...], { connectorRegistry: createConnectorRegistry([adapter]) })`. Write the "matching" artifact with a first `--out <tmp>` run, then run `--diff <tmp> [--check]`. Make it "stale" by changing the fake result, for example adding a column. The five cases are unchanged. Add a **sixth**: after `--out`, flip a `sensitive` flag in the written `schema.json`, then `--diff --check` → exit 0 (the #189 merge must keep sensitivity edits from counting as drift). For one end-to-end spawn case, reuse the Prisma pattern in `apps/cli/src/introspect-shim.test.ts` ("--diff reports unchanged against an artifact written by --out from the same source"), which needs no database. Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`). The owner boundary is `runIntrospectCli`'s exit code, and the regressions caught are drift not failing CI, and `--diff` alone starting to fail CI.
- **Step 6 (docs)**: besides `docs/integration/installable-package.md` (its `## Introspection` section, around line 112, is the place), AGENTS.md requires the docs site to stay accurate. Add `--check` to the flag table in `apps/docs-site/src/content/docs/reference/cli.mdx` (`### askdb introspect`; the table currently ends with ``| `--diff <existing>` | Diff against an existing schema artifact. |``), and put the exit codes and a one-line CI example under it. Also update the `--diff` bullet in `docs/specs/introspection.md` "In scope".
- **Changeset**: still `askdb` minor. `askdb` is in a `linked` group with `@askdb/core` and `@askdb/http-api` (`.changeset/config.json`). Run `pnpm changeset status` and confirm nothing else moves unexpectedly.

#### Commands (current repo)

Use `pnpm --filter askdb exec vitest run --config ../../vitest.config.ts src/introspect-registry.test.ts` for the fast loop. Before the PR, run `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight`. The CLI tests execute `dist/cli.js`, which Turbo builds before `test` (#180 removed the in-test builds), so run `pnpm build` first when using vitest directly.

#### Interactions with newer plans

- **Plan 062** (renderer fidelity) adds `comment`/`enum`/`relationships[].constraint` to `schema.json`. The first `--diff --check` after upgrading will report drift for databases with comments, enums or composite FKs. That is correct behavior (the artifact really is out of date), but mention it in the CLI docs' CI example.
- **Plan 064** adds `partition_fk_partial` / `partition_fk_conflict` warnings. In check mode they are printed to stderr like other warnings (Step 3) and do **not** affect the exit code. Only `changed` does.
- Branch name per the current convention: `plan/039-introspect-check-exit-code`.

### Plan 042 (#228): Reposition `@askdb/ai` as reusable config→model resolution, not "AskDB's model layer"

**Depends on** (updated 2026-09-25): #198 (implements plan 041; must be merged) — hard for the rescoped version in "Post-review delta (2026-09-25)" below. Plan 057 (native `reasoning`) is soft: if it has landed, describe reasoning via `resolveReasoning`, not `resolveProviderOptions`.

The 2026-09-25 architecture review (`docs/reviews/2026-09-25-architecture-and-release-review.md`, section "One package per LLM provider — no") **disagreed with this plan's premise**. The plan is rescoped to a small docs change. Everything above is kept as history. **Execute this section, not the Steps above.** Facts were verified on `review/integration-check @ c7404d4` (main plus review PRs #180–#205).

#### What changed since this plan was written

- **#198 implements plan 041.** The four adapters are built into `@askdb/ai`, which now has one `BUILTIN_AI_PROVIDERS` table plus a `gateway` provider (Vercel AI Gateway, bundled with `ai`). `createAiRegistry()` with no argument registers every built-in, and the string form `createAiRegistry(["openai"])` exists. The `@askdb/ai-*` packages are deprecated shims (removal: plan 060). **Step 0 is obsolete**: always use the string form or no argument.
- **#196** makes `ai` a peer of `@askdb/core` at `^6 || ^7`. `@askdb/ai` and `@askdb/client` still peer on `ai@^7.0.51` only (`packages/ai/package.json`). `reference/packages.mdx` already says the config-driven path "currently requires AI SDK 7".

#### Why the premise is rejected

1. **`@askdb/ai` is key-centric.** `AiConfig` is `{ provider, apiKey, model, baseURL?, providerOptions? }`, and `resolveBaseConfig` (`packages/ai/src/provider.ts`) returns `undefined` ("AI disabled") when no API key resolves. It can't express AWS IAM, Google ADC, Azure Entra ID, or keyless local models. Pitching it as the app-wide model factory would push hosts with a real AI stack onto a weaker auth model.
2. **"Portable reasoning is unavailable from `ai`" is false as of `ai@7`.** `LanguageModelCallOptions.reasoning` (`'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`) is mapped natively by each provider. Migrating AskDB onto it is plan 057. Delete the "Portable reasoning effort" section from Step 1.
3. **Step 5's `createLanguageModelForApp` duplicates `AiRegistry.createLanguageModelFromEnv(env, { modelDefault })`**, which already returns `LanguageModel | undefined`. **Drop Step 5**, and with it `packages/ai/src/app-model.test.ts` and the `minor` changeset.

#### Rescoped work (docs only)

1. **Fix the inaccurate sentence** in `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx`, under "Which should I use?". The current text on c7404d4 is: "`@askdb/ai`'s registry only resolves models for AskDB's own config shape, so if you need the model object for other LLM calls too, building it with the AI SDK directly is usually less code, not more." It is wrong: the registry returns a plain `LanguageModel` that can be reused anywhere. The real limit is auth. Replace it with something like: "`@askdb/ai` resolves an API key, model id, and optional base URL from `askdb.config.*`. It returns a plain `LanguageModel`, but it can't express IAM roles, Google ADC, Entra ID, or keyless local models. If your app already owns provider configuration, keep it there: pass `ask()` a model you build, an AI Gateway model id string, or a model from your own `createProviderRegistry()`."
2. **Document the two BYO options the review recommends** in the same guide's direct-AI-SDK section:
   - **AI Gateway model id strings.** `ask({ model: "openai/gpt-4o-mini", … })` works because `ai`'s `LanguageModel` type includes `GlobalProviderModelId`. Verified in both `ai@7.0.51` (`type LanguageModel = GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2`) and `ai@6.0.291`. `ai`'s default global provider (the gateway) resolves the id and reads `AI_GATEWAY_API_KEY` itself. Check that behavior against the `ai` docs before writing it.
   - **`createProviderRegistry` from `ai`** (exported in `ai@7`) for hosts with several AI features. Build one registry, then pass `registry.languageModel("openai:gpt-4o-mini")` to `ask()` and to the host's own `generateText`/`generateObject` calls.

   Put these as an extra `<TabItem>` in an existing Tabs group, reusing an existing `syncKey` (`ai-provider` is used on this page). Don't invent a new key. Compile-check each snippet in a scratch file under `examples/ask-question/`, then delete it.
3. **`packages/ai/README.md`**: keep the current narrow positioning ("Use this package when you want `askdb.config.*` / env to pick the provider and model"). Add one "When not to use this package" paragraph with the same auth limits and the two alternatives. Don't add a "use it for every other model call" section. The bundler note at the "Custom providers" section already exists; keep it.
4. **`docs/integration/installable-package.md` entry 7**: it now reads "optional config/env-to-model registry with built-in OpenAI, Azure/Foundry, Google Gemini, Anthropic, and Vercel AI Gateway providers …". It is accurate, so leave it. Don't apply the old Step 3 rewrite.
5. **Leave the root `README.md` "Use as a library" section** (now `pnpm add @askdb/core ai` + `@ai-sdk/openai`, lines ~46–72) and **`docs/architecture.md`'s `@askdb/ai` bullet** (the "`@askdb/ai` owns provider dispatch …" paragraph) alone, except for one sentence in the architecture bullet noting the key-centric auth limit.

**Changeset**: `@askdb/ai` patch, because its `README.md` ships in the tarball. No code changes.

**Verify**: `pnpm docs:build` → exit 0. Run `grep -n "only resolves models for AskDB's own config shape" apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` → no match. Run `git grep -n "createLanguageModelForApp"` → no match.

**Updated done criteria (replace the list above)**: the three docs surfaces are updated, every new snippet is compile-checked, no new `syncKey` value is introduced, there are no package source changes, a patch changeset exists for `@askdb/ai`, and `pnpm docs:build` passes.

**STOP** if the AI Gateway string-id behavior (item 2) can't be confirmed from the `ai` package docs or source at the installed version. Document only `createProviderRegistry` in that case.

### Plan 043 (#229): Have `askdb init` write a `.gitignore` into the schema artifact directory

**Depends on** (updated 2026-09-25): PR #194 merged (Studio's `ensureSchemaDirGitignore` — the logic to share). Soft: plan 066a (creates `@askdb/config/scaffold`, the recommended home for the shared helper — see Post-review delta).

Re-checked against `review/integration-check @ c7404d4` (origin/main + review PRs #180–#205). The body above was written at `cc1193a`; its line numbers and one excerpt are stale.

#### What landed since this plan was written

- **PR #194 (Studio execute hardening) made Studio write a schema-dir `.gitignore`** — but only when Playground history is first saved. `apps/studio/src/server.ts`, `appendPlaygroundHistory()` calls `ensureSchemaDirGitignore(schemaDir)` before writing `playground-history.json`. Its behavior:
  - No `.gitignore` yet → writes `# Written by AskDB Studio.` + a comment + `playground-history.json`, and **this plan's `.env` rules** (`.env`, `.env.*`, `!.env.example`, with a "Credentials: …" comment) — **unless** `isProjectRootDir(schemaDir)` (the dir contains `package.json` or an `askdb.config.*` file), where ignoring `.env` is "the project's call, not Studio's".
  - Existing `.gitignore` without the entry → **appends** `# AskDB Studio Playground history (local only)` + `playground-history.json`; never rewrites, never adds `.env` rules to a user's file.
  - Any failure is swallowed (non-fatal), like this plan's Step 1.
  - Tests: `apps/studio/src/server.test.ts` asserts the new file contains `playground-history.json`, `.env`, `.env.*`, `!.env.example`, and `it("appends the history entry to an existing .gitignore without rewriting it")`.
  - The docs site already describes it (`apps/docs-site/src/content/docs/studio.mdx`, security model: "…adds that file to the directory's `.gitignore`… If Studio creates the `.gitignore`, it also ignores `.env` files there.").
- **PR #185** changed `renderIntrospectionSection` to emit `outputDir: ${tsString(schemaOut)}` (JSON-escaped), not the `"${schemaOut}"` quoted in "Current state" above. Irrelevant to this plan's logic, but the excerpt no longer matches — **don't treat that as a drift STOP**.
- `finishInit` moved (≈`apps/cli/src/init.ts:1014` at c7404d4) but its `.env.example` block — the pattern Step 1 copies — is unchanged. `mkdirSync` is still not imported in `init.ts`.

#### What is still left

1. **`askdb init` still writes no `.gitignore`** (`git grep -n "gitignore" -- apps/cli/src` → none). A user who runs `init` → `introspect` and never saves Playground history has no protection — the original problem stands.
2. **`askdb introspect --out <dir>` still writes none** (`apps/cli/src/introspect.ts`: `const outDir = opts.out!; return introspect(input, { outDir, schemaId, existingArtifactDir: … }, { connector });`). Previously a Maintenance-notes follow-up; now it should be in scope because a shared helper makes it one call.
3. **Studio's guided setup** (`writeSetupConfig` + `handleSetupIntrospect`) also creates the artifact dir without a `.gitignore` until history is saved. Optional here; one extra call.

#### Revised approach: one shared helper, used by all three writers

Do **not** copy Studio's logic into `init.ts`. Extract it into one helper with two modes:

```ts
/** Create `<dir>/.gitignore` with AskDB's artifact rules if missing; optionally append required entries to an existing one. Never throws. */
export function ensureArtifactGitignore(dir: string, options?: { appendIfMissing?: string[] }): void
```
- Missing file → write the union content: header, `playground-history.json`, and the `.env` / `.env.*` / `!.env.example` block unless `isProjectRootDir(dir)` (reuse Studio's check; it supersedes this plan's "skip if `schemaOut` resolves to the config directory" rule and covers it).
- Existing file → if `appendIfMissing` given, append only those missing entries (Studio passes `["playground-history.json"]`); otherwise leave it untouched (init/introspect never modify a user's file — this plan's "never overwrite" rule).
- Creates `dir` with `mkdirSync(dir, { recursive: true })` only when called from `init` (the artifact dir doesn't exist yet); introspect's render already creates it (`packages/introspect/src/render/render.ts` `mkdirSync(options.outDir, { recursive: true })`) — call the helper **after** `introspect()` returns.

**Where it lives:** if plan 066a has landed, in `@askdb/config/scaffold` (`packages/config/src/scaffold/gitignore.ts`) — both the CLI and Studio's server already depend on `@askdb/config`, and both apps are compiled with plain `tsc` (no bundler), so shared runtime code must live in a published package they both depend on. If 066a has not landed, either land it first or put the helper in `@askdb/config/scaffold` as the first file of that subpath (following 066a Step 1–2 for the `exports` entry), and switch Studio's `ensureSchemaDirGitignore` to call it. Do **not** put it in `@askdb/introspect`: the library's `introspect()` is used programmatically, and writing a `.gitignore` there would be a behavior change for library users.

#### Updated steps (replace Steps 1–2 above)

1. Add `ensureArtifactGitignore` (+ `isProjectRootDir`) to the shared module; move Studio's tests of the create/append behavior to the helper's own test file only if they can be expressed without the HTTP server — otherwise keep the two Studio HTTP tests as the owner and add helper tests just for the init/introspect-specific mode (existing file left untouched when `appendIfMissing` is absent). Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`).
2. Studio: `ensureSchemaDirGitignore(schemaDir)` → `ensureArtifactGitignore(schemaDir, { appendIfMissing: ["playground-history.json"] })`. Studio tests must pass unchanged.
3. `askdb init` (`finishInit`, after the `.env.example` block): `ensureArtifactGitignore(resolve(dirname(configTarget), answers.schemaOut))` with `mkdirSync` first; echo `  - <path>/.gitignore` only if it was created (have the helper return `"created" | "appended" | "unchanged"` so callers can print).
4. `askdb introspect --out`: after `introspect()` resolves, `ensureArtifactGitignore(outDir)` (not for `--print` / `--diff`).
5. Tests in `apps/cli/src/init.test.ts` (`describe("runInitCli --yes --skip-install")`, next to `it("writes config with default Postgres branch")`): this plan's original cases 1, 3 and 5 at the CLI boundary (created with `.env` rules; existing file byte-identical; write failure doesn't change exit code). Case 2 (dir created) folds into case 1; case 4 (project-root guard) is owned by the helper test. One introspect test that `--out` into a temp dir produces the file.
6. Docs: `apps/docs-site/src/content/docs/reference/cli.mdx` (init and introspect sections: one sentence each) and keep `studio.mdx`'s sentence accurate. Changeset: `askdb` patch, `@askdb/studio` patch, plus whatever the helper's package needs (`@askdb/config` minor if it adds the `./scaffold` export here).

#### Updated STOP conditions

- `ensureSchemaDirGitignore` no longer exists in Studio or behaves differently from the description above — re-read it and report before extracting.
- Moving the helper changes any Studio `.gitignore` test outcome.

### Plan 047 (#232): Make `subtree` tenant access actually include descendants

> **Status (2026-09-29): #232 is closed as completed by #270** (merged 2026-09-27). #270 implemented `subtree` expansion with a host resolver, `resolveTenantDescendants(tenantRoot, seedIds)`, whose result `ask()` folds into `{ kind: "ids", tenantRoot, ids }` for the same root (`packages/core/src/ask.ts`, `expandSubtreeScope`). That is the design the "Design correction" bullet below argues against, and the critique holds: in a multi-table hierarchy, a resolver that returns descendant-level IDs (as the public docs tell it to) gets them bound under the root's placeholder, and rows leak across tenants. That is #338 (P1; unreleased, so it should block the release that ships #270's changeset); its option 1 is the per-root expansion described below, rescoped onto #270's API. #197 kept only a fail-closed guard: `resolveTenantSql` rejects an unexpanded `subtree`. #268 tracks a built-in recursive-CTE alternative, and needs rescoping for the same reason. The rest of this section is the 2026-09-25 delta, trimmed of its claims that `subtree` is rejected everywhere and that plan 054 would implement it, which no longer hold.

The analysis in #232 still holds: `subtree` was silently under-scoped, the hierarchy data is collected but not read at query time, the fix must be fail-closed, and a host resolver fits AskDB's "never executes SQL" boundary.

What the 2026-09-25 delta found (checked against `review/integration-check @ c7404d4`):

- **Rejection.** An earlier revision of #197 rejected `subtree` everywhere. As merged, after #270, #197 keeps only the `resolveTenantSql` guard, and Studio's Subtree button stays removed because Studio has no resolver.
- **#197 also landed plan 046 Steps 1–4.** Substitution is dialect-correct, token-aware and fail-closed (`UNRESOLVED_TENANT_PLACEHOLDER`, `UNSUPPORTED_TENANT_PREDICATE`). This plan's line references to `tenant-placeholders.ts` (`buildIdsByRoot` at 91-110, `ask.ts:333-345`) are stale.
- **Design correction.** Steps 2–3 here had the resolver return one flat list and rewrote the scope to `{ kind: "ids", tenantRoot, ids: expanded }`. Under the tenant-policy contract, descendants are rows of **other root tables** (agencies → sub_agencies → clients), each with its own ID space and placeholder. Folding child IDs into the parent root's placeholder would compare, e.g., client IDs against `orders.agency_id`, which leaks across tenants on any ID collision. The review's alternative (drafted as plan 054, not filed) expanded a subtree into per-root ID sets (a `multi_root` scope), gave the host resolver a traversal plan (levels in dependency order, with their foreign keys), and expanded **before** prompt generation so the model sees every level's placeholder. #338 confirms the critique against #270 as merged, with a reproduction.
- **Step 5 (built-in recursive CTE)** is tracked in #268 and should be revisited with plan 050's rewriting spike (#235).

### Plan 049 (#234): Document database-level tenant enforcement (Postgres RLS) as the primary path

**Depends on** (updated 2026-09-25): #184 and #190 merged (see the post-review delta at the end). Plan 045 (soft; its honesty steps landed via #184/#197). 045 rewrites the guardrail's self-description to match reality; this plan supplies the enforcement story that description points at. They are complementary and can land in either order, but landing 045 first means this page has something accurate to link back to.

Checked against `review/integration-check @ c7404d4` (main plus review PRs #180–#205). The plan is still TODO. The framing work it asked for mostly landed through #184. The **runnable recipe** (the core of Step 1) still doesn't exist, and #190 adds a requirement the recipe has to state.

**Already done by #184 (don't redo it; align with it):**
- Step 4's inversion is done. `docs/specs/multi-tenancy.md` now says, near the top, "The guardrail is defense in depth, not a security boundary. Production deployments should enforce tenant isolation in the database…", and its non-goals entry reads "RLS (or equivalent database-level enforcement) is the **recommended primary tenant boundary**". `git grep -n "still recommended as a defense-in-depth layer" -- docs` → no matches. `docs/contracts/tenant-policy.md` "Guardrail validation" already says "heuristic lint, not a security boundary … Enforcement must come from the database (for example row-level security)".
- Step 2's admonition exists. `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` has `<Aside type="caution" title="Enforce tenancy in your database">` right after "How it works". Add the trust-tier explanation and the recipe link next to it rather than adding a second admonition.
- New pages and sections to link from and keep consistent: `apps/docs-site/src/content/docs/concepts/safety-boundaries.mdx` "Run generated SQL safely" ("Enforce tenancy in the database … Postgres row-level security (RLS) keyed on a per-request setting, per-tenant views, or per-tenant roles"), `guides/run-safely-in-prod.mdx` "Multi-tenancy" (says "keyed on a per-request setting"), and **`SECURITY.md`** "What integrators should do". Add `SECURITY.md` and `concepts/safety-boundaries.mdx` to the in-scope list.
- File references: the multi-tenancy guide's sections are now `## How it works` (12), `## Tenant policy concepts` (28), `## Authoring the policy` (38), `## Field reference` (83), `## Asking with a tenant scope` (136), `## SQL output modes` (197), `## What changes in the SQL` (221), `## Without a policy` (240), `## Testing in Studio` (246), `## Read next` (262). "What gets rewritten" is now "What changes in the SQL". Plan 038 has not landed, and `docs/integration/executing-generated-sql.md` doesn't exist, so follow the "038 NOT LANDED" branch.
- Where the recipe lives: the docs site is the product surface (AGENTS.md). Put the recipe on the docs site, either as a new section of `guides/multi-tenancy.mdx` or as a new `guides/` page linked from the three pages above. Keep `docs/integration/tenant-enforcement.md` only if you want an internal copy, and don't let the two drift.

**New requirement from #190 (`set_config` is blocked), which the recipe must state:**
- The docs now point readers at RLS "keyed on a per-request setting", i.e. a GUC such as `current_setting('app.tenant_ids')`. That policy is only as strong as the guarantee that the SQL being executed **cannot change that setting**. #190 added `set_config` to the Postgres `blockedFunctions` (`packages/core/src/sql/dialect-spec.ts`; pinned in `packages/core/src/sql/validate.test.ts` with `SELECT set_config('default_transaction_read_only','off',false)`), and `validateSelectSql` only accepts a single `SELECT`/`WITH` statement, so `SET app.tenant_ids = …` can't pass. If `set_config` were allowed, a generated `SELECT set_config('app.tenant_ids', '<other tenant>', true), …` would defeat the policy inside the host's own transaction. The recipe must say this explicitly, and say that it's why `set_config` must stay blocked.
- The recipe must also say that the validator is a lexer-based denylist (defense in depth, not a boundary), so **the host must still execute under a role that cannot set the GUC** that keys RLS. Before writing that sentence as a recommendation, verify on the Pagila Postgres (`pnpm pagila:up`, `localhost:5433`) whether a non-superuser role can be prevented from changing a custom `app.*` parameter (e.g. PostgreSQL 15+ `GRANT SET ON PARAMETER` / `REVOKE`, and whether it applies to custom placeholder parameters). If Postgres can't deny it, the page must say so plainly and recommend a key the session can't forge instead: per-tenant login roles or `current_user`-based policies, or a `SECURITY DEFINER` lookup the application role can't bypass. It must not claim the GUC is unforgeable. This is a new STOP-worthy check. If you can't verify it against a real instance, say so in the page and in your report.
- Also show the host executing the generated SQL as a **single statement over the extended protocol** (node-postgres with parameters, or `queryMode: "extended"`, as Studio does in `apps/studio/src/execute-registry.ts`). The simple query protocol runs multiple statements. `docs/specs/studio.md` documents the verified Postgres incantations (`BEGIN READ ONLY`, `SET LOCAL statement_timeout`, extended protocol), so reuse them.

**Related after #197/#186 and plans 053–056:** tenant IDs reach the host through `tenantBindings` (and `tenantParams` in `sql-params` mode). The recipe's `SET LOCAL app.tenant_ids = …` should be built from the **same `tenantScope`** the host passed to `ask()`, never parsed out of the generated SQL. If plan 054 has landed, a `subtree` scope expands to per-root ID sets, so show the multi-ID policy with an array-typed setting. The maintenance note about AskDB emitting the session-setting statement is still a valid follow-up.

### Plan 050 (#235): Design spike — deterministic tenant predicate rewriting

**Depends on** (updated 2026-09-25): #190 and #197 merged; plan 055 (soft, the guardrail on the shared lexer). See the post-review delta at the end. Originally: plan 045 (soft) — 045 establishes the honest baseline description of what the guardrail does and does not do. This spike proposes what would replace it.

Checked against `review/integration-check @ c7404d4` (main plus review PRs #180–#205). The spike is still TODO and still needed. Its baseline has moved, so design against the state below, not the "Current state" section above.

**The tenant check is still a presence test.** After #197 and #190 it only looks at code regions (#197 blanks string literals and comments), but it still only checks that identifiers are present. Two tests in `packages/core/src/sql/tenant-guardrail.test.ts` (`describe("validateTenantGuardrails — matches only in code regions")`) pin this on purpose, as tripwires for this spike:
- `"known limitation: a selected (not filtered) tenant column still passes"`: `SELECT agency_id FROM orders` → no warnings.
- `"known limitation: an OR-widened predicate still passes"`: `SELECT * FROM orders WHERE agency_id IN ('42') OR 1=1` → no warnings.

Any design this spike recommends must flip these to failing (or refused) cases. Say which increment does it.

**Stale "Current state" references:**
- `normalizeSql` is no longer `sql.toLowerCase()`. #197 made it a local, length-preserving scanner that blanks `'…'`, `$tag$…$tag$`, `--` and `/* */`. Plan 055 replaces it with the shared lexer and threads the dialect. Design against 055's state (land 055 first, or note which state you assumed).
- The lexer is no longer `bind.ts`'s `tokenizeSqlSpans`. #190 added `packages/core/src/sql/lexer.ts` (`lexSql(sql, profile)`, `lexerProfileFor(dialect)`, `GENERIC_LEXER`, `ENGINE_LEXER_PROFILES`). It has per-dialect rules for strings, quoted identifiers, `#`/`--`/nested block comments and MySQL executable comments, and it flags `unterminated` tokens. `tokenizeSqlSpans` is now a thin code/quoted/comment view over it. **This lexer is the natural base for any clause scanner or rewriter.** It's still a lexer and not a parser. Keep the spec strict about that distinction, as the maintenance notes already ask.
- `stripSqlStringLiterals` no longer exists. `source: "question" | "tenant"` is still on the parameter manifest (`bind.ts`, `PreparedQuery.parameters[]`), and `sqlStructurallyEqual` still exists in `bind.ts`.

**New in-repo prior art for Steps 2–3:** #176 and #190 gave the sensitive guardrail (`packages/core/src/sql/sensitive-guardrail.ts`, `scanTokens`) a token-level resolver. It finds `FROM`/`JOIN` targets and their aliases, including inside CTEs and derived tables, over `lexSql` output. When scope can't be proven it fails conservatively and reports why (`unresolvedScope`). That's close to the "minimal FROM/JOIN clause scanner" option in Step 3 and the alias/CTE/subquery cases in Step 2. Evaluate extracting and sharing it. Count which of Step 2's eight cases it already resolves, and use its `unresolvedScope` behavior as a model for the refusal path.

**The input is narrower now.** `validateSelectSql` (#190) accepts only a single `SELECT`/`WITH` statement with no comments, no unterminated tokens, and no denylisted keywords or functions (per-dialect `blockedFunctions`, incl. `set_config`). Use this when quantifying Step 3's "restrict the subset" option.

**Related plans have changed:**
- 045 is done via #184 (docs honesty) and #197 (code regions).
- 046 Steps 1–4 are done via #197. Tenant substitution is token-aware, dialect-marker-correct and fail-closed. Any rewriter must emit markers consistent with #197's executable-pairs contract (`sql` + `tenantParams`; `unboundSql` + `params`, where `?` dialects interleave in source order; see `bindTenantIntoUnboundSql` in `packages/core/src/ask.ts`). Plan 053 makes `sql-params` the default.
- 047 was done by #270, which expands `subtree` into an `ids` scope before substitution, so the rewriter's input is always `ids` / `multi_root` / `global`. (This delta originally said plan 054 would expand `subtree` into per-root ID sets; that is now #338's option 1, and it would also produce a `multi_root` scope.)
- 049's framing landed via #184. RLS is documented as the primary boundary, so this spike is specifically about deployments that can't use it.

**Readiness check (replaces the drift check):** `gh pr view 190 --repo Ygilany/AskDB --json state -q .state` and `gh pr view 197 …` → `MERGED`; `git grep -n 'known limitation: an OR-widened predicate still passes' -- packages/core/src/sql/tenant-guardrail.test.ts` → 1 match (problem still present).
