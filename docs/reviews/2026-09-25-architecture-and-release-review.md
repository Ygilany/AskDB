# Architecture and public-release review — 2026-09-25

Reviewed at `26ca2bf` (`main`). Six parallel read-only reviews (AI layer, database layer, core SQL
safety, product-surface security, release readiness, RAG/enrich/test quality), followed by fix PRs
#180–#199. Every finding below was verified against the code before a PR was opened; bypasses were
reproduced against the built `dist`.

## Verdict

The pipeline design is sound: `ask()` stays BYO-model and returns SQL, engine knowledge lives in
integration packages, and the Schema v2 artifact is a good contract. What blocked a public release
was not the architecture but three things:

1. **The safety story was overstated.** Docs said generated SQL is "parsed", that system schemas are
   rejected, and that AskDB "rewrites the query to guarantee the tenant filter". None of that was
   true. The validator was a quote-stripper plus a keyword denylist with concrete bypasses, and strict
   tenant mode could return unscoped SQL with `passed: true`.
2. **Studio was reachable from any web page.** No Host/Origin/CSRF protection, execute on by default,
   Postgres read-only escapable via the simple query protocol, and the setup wizard wrote
   unescaped strings into a TypeScript config it then evaluated (RCE when chained).
3. **CI never ran the database integration suites** (Turbo strict env mode dropped `DATABASE_URL`
   and friends), so every DB-backed claim was untested in CI.

## Architecture questions

### One package per LLM provider — no

The four `@askdb/ai-*` packages each wrapped 25–120 lines of provider *data* (env names, default
model, factory call, reasoning mapping) in a full npm package. The split delivered no install
savings — CLI, HTTP API and Studio eagerly registered all four — while costing four release units,
a provider list enumerated in 9+ places (already drifted: `ASKDB_AI_PROVIDERS` lacked `anthropic`),
and peer-dependent major bumps (adapters jumped `0.1.0-beta.2 → 1.0.0-beta.3`). Mock-only tests also
hid real bugs (Azure embeddings silently dropped `dimensions`).

**Decision (PR #198, amends ADR 0006 to Option E):** one `@askdb/ai` with built-in providers loaded
lazily and `@ai-sdk/*` as optional peers; a single provider table; `createAiRegistry()` defaults to
built-ins; the `gateway` provider (bundled with `ai@7`) is added for free; the four packages become
deprecated re-export shims, to be removed before 1.0. `AiProviderAdapter` stays the third-party
extension point.

`@askdb/ai` should be positioned narrowly — "turn `askdb.config` into a model" — not as a general
app model factory: it is key-centric and cannot express IAM/ADC/Entra/local-model auth. Hosts with
an AI stack should pass a `LanguageModel`, an AI Gateway string, or their own
`createProviderRegistry`. `ai@7` also has a portable top-level `reasoning` option that providers map
natively; AskDB's hand-maintained reasoning regexes should migrate to it (follow-up).

Separately, `@askdb/core` hard-depended on `ai`, pinning consumers' AI SDK major (a real consumer is
stuck on `beta.40` with `ai@6`). **PR #196** makes it a peer (`^6 || ^7`) and switches to the `system`
key, which both majors accept — this also fixes a silent bug where `ai@6` hosts got no system prompt.

### One package per database — yes, but with a shared kit and an open registry

Per-engine packages are the right boundary (optional peer drivers, engine-specific catalog SQL,
independent release). Dialects already moved into `@askdb/core` (`dialect-spec.ts`), so a separate
`@askdb/dialects` package would add nothing. What hurt:

- Roughly 600–700 duplicated lines across the engines (byte-identical `glob.ts`/`ids.ts` ×5, driver loader ×4,
  FK/unique/index builders ×3–4). **PR #195** extracts `@askdb/introspect/kit`.
- `@askdb/connectors` was a map lookup over a *closed* provider union — third parties could not add an
  engine, contradicting ADRs 0002/0007 — and the CLI and Studio still kept per-engine connection
  switches. **PR #199** moves the registry into `@askdb/introspect` with open provider ids and a
  `resolveConnection` hook, deletes both switches, deprecates `@askdb/connectors`, and records
  ADR 0008.

Follow-ups: session-scoped catalog runner (one connection, snapshot, timeout) instead of a new pool
per query; the renderer drops comments, enum labels and composite-FK grouping that connectors already
compute (needs a Schema v2 minor).

## What AskDB guarantees now (after the PRs)

AskDB's guardrails are **defense in depth, not a security boundary**. After #190/#186/#197:
a dialect-aware lexer (E-strings, exact `$tag$`, backslash rules, `#` comments, brackets only on
SQL Server; unterminated tokens rejected), a single statement starting with `SELECT`/`WITH`, keyword
and per-dialect function denylists (incl. `INTO`, `OUTFILE`, `set_config`, `dblink_exec`, T-SQL
batch verbs), sensitive-column detection including `*`/`t.*`/whole-row functions, and tenant checks
that run on the SQL actually returned, for every dialect, failing closed on malformed policies. The
host must still execute with a least-privilege read-only role, enforce tenancy in the database
(RLS), and set timeouts. #184 rewrites the docs to say exactly this.

## PR map and merge order

Independent PRs off `main` can merge in any order. Stacked PRs are GitHub native stacks (`gh stack`):
#206 = #188→#198, #207 = #185→#194, #208 = #186→#197→#192, #209 = #189→#195→#199 (and #191 is already
on `main` after #180). Merge bottom-up; GitHub rebases and retargets the layers above automatically. Expected conflicts are small: `pnpm-lock.yaml` (re-run
`pnpm install`), ADR 0006 amendment tail (#196 vs #198), LICENSE/NOTICE added identically by #182
and #183, and docs pages touched by #184 plus a feature PR.

| Order | PR | Base | Area | Why it matters |
|---|---|---|---|---|
| 1 | #180 | main | CI | Integration suites actually run; fail-on-skip |
| 1a | #191 | #180 | CI | lint/audit jobs, Node 22.12/24 matrix, SHA pins, least privilege, Dependabot; fixes a critical Astro advisory via lockfile |
| 2 | #185 | main | Studio | Host/Origin/token guard; config-injection (RCE) fix |
| 2a | #194 | #185 | Studio | Execute opt-in, single-statement read-only, timeouts, row caps |
| 3 | #186 | main | core | Tenant enforcement fails closed (returned SQL, custom dialects, malformed policy) |
| 3a | #197 | #186 | core | Tenant binding: dialect markers, fail-closed placeholders, operators, literal-injection; drop `tenantFilters`; reject `subtree` |
| 3b | #192 | #197 | core | Front-matter sensitivity (Studio) actually takes effect, escalate-only |
| 4 | #190 | main | core | Dialect-aware lexer; closes read-only and sensitive-column bypasses |
| 5 | #184 | main | docs | Safety claims made accurate; "run generated SQL safely" guidance; SECURITY.md model |
| 6 | #181 | main | enrich | Bundles keep `tenant-policy.md` (tenant isolation was silently lost) |
| 7 | #187 | main | http-api | Typed error mapping (502 was dead code), config sensitivity floor, schema override gated |
| 8 | #189 | main | introspect | `--diff` correctness, partition/SQLite/MySQL FK fixes, password redaction |
| 8a | #195 | #189 | introspect | Shared engine kit; ~600 duplicated lines removed from the engine packages |
| 8b | #199 | #195 | introspect | Registry into introspect, open ids, ADR 0008 |
| 9 | #188 | main | ai | Azure/Google embedding options, reasoning detection, Azure config, real-SDK contract tests |
| 9a | #198 | #188 | ai | Fold adapters into `@askdb/ai` (ADR 0006 amendment) |
| 10 | #196 | main | core | `ai` as peer (`^6 || ^7`) |
| 11 | #193 | main | rag | Store-verified incremental indexing, schema-scoped ids, sensitive filtering |
| 12 | #183 | main | release | LICENSE/NOTICE in every tarball + smoke assertion, Node ≥22.12, trimmed install footprint |
| 13 | #182 | main | cli | `--help`/`--version` without config; README accuracy |

**Composition verified:** draft PR #201 merges all of the above onto #191 and is green in CI with
the real Postgres/Pagila, MySQL, SQL Server, SQLite and pgvector suites. Its description has the
per-file conflict resolutions and five small composition fixes (e.g. #192's chunk-id test vs #193's
new id format; passing the dialect through `ask()`'s guardrails once #190 lands; #183's lazy Prisma
import vs #199's registry) to apply while merging. Do not merge #201 itself.

Merge #180 early: once it is in, every later PR's CI run exercises the real databases. PRs opened
before it (notably #189's partition-FK and #193's pgvector tests) should be re-run after rebasing.

## Maintainer actions (not doable from a PR)

- **Leaked key:** an `sk-proj-` key committed to `.env.example` (e.g. `5e20605`) is still reachable
  from ~53 stale remote branches. Confirm it is revoked in the OpenAI console; prune the branches.
- **Repo settings:** branch protection on `main` with required checks; secret-scanning push
  protection; Dependabot security updates; read-only default `GITHUB_TOKEN`.
- **npm dist-tags:** `beta` points at stale `0.5.0-beta.*`; `latest` points at prereleases.
- **PR #179 (release automation):** the version PR opened with `GITHUB_TOKEN` will not trigger
  `ci.yml`, so the claimed CI gate does not hold. Use a GitHub App token; split version (no npm
  credentials) and publish (protected environment, `has-changesets == 'false'`) jobs; npm trusted
  publishing (OIDC); SHA-pin `changesets/action`.
- **Versioning:** commit to the 1.x line (npm already has `1.0.0-beta.*`). Before GA, land the
  breaking changes still in prerelease (#196, #198, #199, #197's `tenantFilters` removal), then
  consider `"fixed": [["askdb", "@askdb/*"]]`, `privatePackages: { version: false }`, and
  `pre enter rc`. #198 turns on `onlyUpdatePeerDependentsWhenOutOfRange` to stop spurious peer-major
  bumps — keep or drop that commit deliberately.
- **Internal files:** `plans/`, `thunder-tests/`, `.claude/settings.local.json`, `skills-lock.json`
  are public in the repo. Keep `plans/` if the workflow depends on it, but it documents open
  security gaps — consider moving it after these PRs land.
- **`AGENTS.md`** lines about `@askdb/ai-*` peer adapters become stale once #198 merges.

## Deferred (recommended next)

Each item below is now an executable plan — see plans 053–071 and the post-review deltas on 038, 039, 042, 043, 047, 049, 050 in [`plans/README.md`](../../plans/README.md). Start with plan 071 once the review PRs have merged.

- Plan 046 step 5: default `tenantSqlMode` to `sql-params`.
- Plan 047: real `subtree` descendant expansion (currently rejected, fail-closed).
- Plan 049: document database-level tenant enforcement (RLS) as the primary path — note that
  `set_config` must stay blocked since RLS keyed on a GUC is otherwise defeatable.
- Plan 050: deterministic tenant predicate rewriting (the tenant check is still a presence test;
  `... OR 1=1` passes).
- Plan 038: dialect-aware row-limit helper in core (Studio has its own until then).
- Migrate reasoning effort to `ai@7`'s native `reasoning` option.
- Provider-neutral RAG embedder config (Studio asks Google for an OpenAI embedding model today).
- Move `askdb-rag` into `askdb rag` and drop `@askdb/rag`'s dependency on `@askdb/config`.
- Split `apps/studio/src/server.ts` (~1.9k lines) and `apps/cli/src/init.ts` (~1.1k lines); merge the
  duplicated config renderers in `init.ts` and Studio `setup.ts`.
- Renderer: composite FKs, enum labels, comments (Schema v2 minor).
- Deeper MySQL/SQL Server/SQLite integration fixtures (views, composite FKs, multi-schema).
- The HTTP API cannot serve tenant-scoped schemas (no way to pass a scope).

## Findings register

Every finding from the six review lanes, with a stable ID. PR descriptions cite the lane-local ID
(for example **C1** in #185, **F2** in #186); the prefixed form below is the unambiguous one,
because each lane numbered its findings independently (security **C1** ≠ RAG **C1**).
Severity letter: **C** critical, **H** high, **M** medium, **L** low; the release lane uses
**B** blocker, **S** should-fix; the core lane numbered its findings **F1–F12**.

Status: a PR number means fixed by that PR; `plan NNN` means captured as an executable plan;
**Open** means not addressed and not yet planned.

### SEC — product surfaces security (Studio, HTTP API, CLI)

| ID | Finding | Status |
|---|---|---|
| SEC-C1 | Studio API had no Host / Origin / CSRF check; any web page (or DNS rebinding) could call `/api/execute` or rewrite schema files | #185 (ADR 0009) |
| SEC-C2 | Setup wizard wrote unescaped values into `askdb.config.ts`, which Studio then executes → code injection | #185 |
| SEC-H1 | Studio "read-only" execute bypassable (pg simple-protocol multi-statement, no SQL Server guard, no `validateSelectSql`) | #194 |
| SEC-H2 | Studio execute always on and silently reused introspection credentials | #194 |
| SEC-H3 | Most mutating Studio endpoints skipped the loopback gate | #185 (token on every `/api/*`) |
| SEC-M1 | HTTP API ignored config `modes.omitSensitiveFromPrompt` | #187 |
| SEC-M2 | HTTP API classified errors by substring (`"mode"` matched "Model"), so 502 was dead code | #187 |
| SEC-M3 | Studio execute had no statement timeout or real row cap | #194 |
| SEC-M4 | Unbounded Studio request bodies; Playground history persisted arbitrary input | #194 |
| SEC-M5 | HTTP API always accepted per-request `schemaJson`; no LLM timeout | #187 |
| SEC-L1 | Studio install-driver: `"constructor"` accepted; `spawn("pnpm")` broken on Windows | #194 |
| SEC-L2 | `askdb init` wrote unvalidated values into TypeScript; renderer duplicated with Studio | #185 (escaping); plan 066 (single renderer) |
| SEC-L3 | HTTP API printed a raw stack on startup errors | #187 |
| SEC-L4 | Security docs inaccurate (SECURITY.md, architecture, Studio page) | #184, #185 |

### CORE — core pipeline and SQL safety

| ID | Finding | Status |
|---|---|---|
| CORE-F1 | Read-only validator bypassable: quote stripper disagreed with the databases (E-strings, `$tag$`, backslashes, `#`) | #190 |
| CORE-F2 | Strict tenant check ran on the unbound SQL, not the SQL returned | #186 |
| CORE-F3 | Malformed `tenant-policy.md` silently disabled tenancy; `schema.json` path skipped the policy | #186 |
| CORE-F4 | Tenant check is a presence test (`… OR 1=1` passes) | #184 (docs); #197 + plan 055 (lexing); plan 050 (rewriting spike) |
| CORE-F5 | Custom `AskDialect` skipped tenant enforcement | #186 |
| CORE-F6 | Denylist gaps: `SELECT INTO`, `OUTFILE`, `set_config`, `dblink_exec`, T-SQL batch verbs | #190 |
| CORE-F7 | Sensitive check missed `*`, `t.*`, whole-row functions | #190 |
| CORE-F8 | Tenant binding: wrong markers, fail-open placeholders, `!=` corruption, literal injection | #197 |
| CORE-F9 | `subtree` scope never expanded descendants | #197 (rejects, fail-closed); plan 054 (implement) |
| CORE-F10 | `tenantFilters` documented but never read | #197 (removed) |
| CORE-F11 | Parameterize consistency check lowercases literals, so `params` can drift from `sql` | **Open** |
| CORE-F12 | Custom dialects escape tenant IDs without backslash handling | **Open** (fold into plan 055) |
| CORE-F13 | Tenant guardrail fail-opens on MySQL strings and uppercase placeholders (found while writing plan 055) | #197 (`886670c`); Postgres `E'…'` remainder in plan 055 |

### DB — database integration layer

| ID | Finding | Status |
|---|---|---|
| DB-C1 | Studio `/api/execute` ran any SQL from any requester | #185 + #194 |
| DB-H1 | `validateSelectSql` bypasses (dialect lexing, denylists) | #190 |
| DB-H2 | `askdb introspect --diff` almost always reported "changed" | #189 |
| DB-M1 | Renderer drops composite FKs, enum labels, comments | plan 062 |
| DB-M2 | Postgres FKs cloned onto partitions rendered to leaves | #189; plan 064 (lift to parent) |
| DB-M3 | SQLite FK without target column pointed at the source column | #189 |
| DB-M4 | Catalog runners open a connection per query; no snapshot or timeout; pool leak on connect failure | plan 061 |
| DB-M5 | Studio showed SQL Server passwords in connection labels | #189 |
| DB-M6 | Engine filter inconsistencies; MySQL URL without a database returned an empty schema | #189 (MySQL error); filter warnings **Open** |
| DB-L1 | SQLite `NOT LIKE 'sqlite_%'` dropped user tables | #189 |
| DB-L2 | SQLite index-origin comment inverted | #189 |
| DB-L3 | Catalog coverage: MySQL cross-database FKs, SQL Server `is_ms_shipped`, Postgres extension schemas | #189 (first two); extension schemas **Open** |
| DB-L4 | Package hygiene: unused http-api deps, Studio driver peer ranges, eager Prisma | #189, #183, #199 |
| DB-L5 | Docs drift in ADR 0007, architecture, connectors guide | #189, #199 |
| DB-A1 | Architecture: ~600 duplicated engine lines; closed connector registry | #195, #199 (ADR 0008) |

### AI — AI provider layer and config

| ID | Finding | Status |
|---|---|---|
| AI-H1 | HTTP API returned model failures as 400 with raw provider text (same root cause as SEC-M2) | #187 |
| AI-H2 | Azure embeddings silently dropped `dimensions` / `user` | #188 |
| AI-H3 | Reasoning-model detection stale / duplicated AI SDK 7 | #188 (tables); plan 057 (native `reasoning`) |
| AI-M4 | Config-driven Azure failed: no `resourceName` in config | #188 |
| AI-M5 | Provider error text returned to HTTP clients | #187 |
| AI-M6 | Google embeddings ignored `dimensions`; deprecated method | #188 |
| AI-M7 | RAG `ai-sdk` embedder effectively OpenAI-only; OpenAI key sent to the selected provider | plan 058 (P1) |
| AI-M8 | Provider list enumerated in 9+ places and drifted | #188, #198 |
| AI-M9 | `ai` was a hard dependency of core | #196 |
| AI-L10 | Wrong install hint for aliases / custom providers | #188, #198 |
| AI-L11 | `as unknown as` / `as any` type holes in client and Studio | **Open** |
| AI-L12 | ADR 0005's env-override allowlist never implemented; messages say "set ASKDB_MOCK_SQL" | #187 (http-api message); CLI/Studio messages **Open** |
| AI-L13 | Docs miss AI Gateway strings and `createProviderRegistry` | plan 042 (rescoped) |
| AI-L14 | Studio duplicates client model/reasoning resolution; tenant suggestion ignores reasoning effort | **Open** (candidate for plan 066) |
| AI-A1 | Architecture: four `@askdb/ai-*` packages for provider data | #198 (ADR 0006 amendment); plan 060 (remove shims) |

### REL — public release readiness

| ID | Finding | Status |
|---|---|---|
| REL-B1 | Safety and tenancy docs overclaimed | #184 |
| REL-B2 | Eight packages shipped without LICENSE/NOTICE | #183, #182 |
| REL-B3 | Node engine range inconsistent (20 vs 22 vs 22.12) | #183, #191 |
| REL-B4 | `askdb --help` / `--version` crashed outside a project; root config imported `dotenv` | #182 |
| REL-B5 | npm dist-tags wrong (`beta` stale, `latest` on prereleases) | plan 067 / 068 (human) |
| REL-S1 | Release workflow: long-lived token, no environment, no branch guard | plan 067 |
| REL-S2 | PR #179: version PR opened with `GITHUB_TOKEN` never triggers CI | plan 067 |
| REL-S3 | CI gaps: no lint/audit jobs, missing permissions, unpinned actions | #191 |
| REL-S4 | Changesets config causes surprise major bumps | #198 (peer option); plan 067 |
| REL-S5 | Large install footprint (Studio UI deps, eager Prisma) | #183 |
| REL-S6 | Leaked key still reachable from stale branches and tags | plan 068 (human) |
| REL-S7 | README inaccurate (status, links, package list) | #182 |
| REL-S8 | Internal files at repo root (`plans/`, `thunder-tests/`, `.claude/settings.local.json`) | **Open** (maintainer decision) |

### RAG — RAG, enrich, and test quality

| ID | Finding | Status |
|---|---|---|
| RAG-C1 | CI never ran the database integration suites (Turbo strict env) | #180 |
| RAG-C2 | `askdb bundle` dropped `tenant-policy.md` | #181 |
| RAG-H1 | Studio sensitivity overrides had no effect | #192 |
| RAG-H2 | Indexer trusted the lock file over the store | #193 |
| RAG-H3 | Chunk IDs not schema-scoped; cross-schema orphan deletion | #193 |
| RAG-M1 | Sensitive prose checks case-sensitive and incomplete | #193 |
| RAG-M2 | Enrich table filenames collide / can escape `tables/` | #181 |
| RAG-M3 | RAG CLI dimension handling inconsistent | #193 |
| RAG-M4 | `@askdb/rag` depends on `@askdb/config` only for its CLI | plan 059 |
| RAG-M5 | Malformed `concepts.md` silently ignored | #186 |
| RAG-M6 | File store writes not atomic | #193 |
| RAG-M7 | Studio skips sensitive-mention warnings and orphan pruning | **Open** |
| RAG-M8 | CLI tests raced on the build output | #180 |
| RAG-L1 | pgvector setup: silent dimension mismatch, `ensureSchema` on every status call | #193 (mismatch); status-call cost **Open** |
| RAG-L2 | pgvector loaded `pg` with a bare import | #193 |
| RAG-L3 | RAG docs drift | #193 |
| RAG-L4 | Test files never typechecked by `lint` | **Open** |
| RAG-L5 | `test` depended on `^test`, serializing runs | #180 |
