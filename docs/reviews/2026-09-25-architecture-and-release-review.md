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

Independent PRs off `main` can merge in any order; stacked PRs must merge bottom-up (retarget the
next layer to `main` after each merge). Expected conflicts are small: `pnpm-lock.yaml` (re-run
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
| 3b | #192 | #186 | core | Front-matter sensitivity (Studio) actually takes effect, escalate-only |
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
