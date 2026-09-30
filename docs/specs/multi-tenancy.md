# Feature: Multi-Tenancy

**Status:** Complete  
**Packages:** `@askdb/core` (policy loading, prompt assembly, SQL validation, output modes), `@askdb/enrich` (authoring helpers), `apps/studio` (UI), `apps/cli` (scope input), `apps/http-api` (scope input)

## Overview

Multi-tenancy support steers AskDB toward generating SQL that is scoped to the current user's authorized tenant boundary. The tenant model is captured once at setup time in a `tenant-policy.md` artifact (alongside `schema.json` in the schema directory), and the current user's authorized scope is passed to `ask()` at runtime via `TenantScope`.

Prompt assembly includes the full policy and scope in every generation request. After generation, and before tenant binding, a heuristic SQL guardrail checks the model's SQL with the `:tenant_*_ids` placeholders still in place: every tenant-scoped table named in it, and every root table the scope covers, needs a tenant predicate that filters (its tenant column compared with the placeholder, ANDed into a `WHERE`, inner-join `ON` or `HAVING` clause), outside string literals and comments. A column that's only selected, a literal ID, `... OR 1=1`, or a negated predicate doesn't count. It does not parse SQL. Within one statement, including its CTEs, derived tables and subqueries (only `UNION`, `INTERSECT` and `EXCEPT` branches are checked on their own), it doesn't tie a predicate to a particular table reference, so an unfiltered reference can pass beside a filtered one, for example `WITH t AS (SELECT id FROM orders WHERE agency_id = :tenant_agency_ids) SELECT * FROM orders` (#399; full rules and limits in [`tenant-policy.md` › Guardrail validation](../contracts/tenant-policy.md#guardrail-validation)). If the policy is configured in `strict` mode, a failed check throws `TenantGuardrailError`; in `warn` mode, the SQL is returned with `tenantGuardrail.warnings` and the host decides.

**The guardrail is defense in depth, not a security boundary.** Production deployments should enforce tenant isolation in the database (row-level security, per-tenant views or roles) and treat AskDB's check as an early warning for model mistakes.

This is a Postgres-first proof. The tenant enforcement model is designed to generalize to other engines when they are added.

**Policy contract:** [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md)

## Scope

### In scope

- **Tenant policy format** (`tenant-policy.md`) — YAML front-matter: roots, hierarchy edges, scoped tables, polymorphic tables, global tables, enforcement mode. Markdown body: business context prose. Lives alongside `schema.json` in the schema artifact directory.
- **Policy loading and validation** — zod-based; cross-reference validation against `schema.json` IDs; unknown tables tracked as `unknown` classification
- **Five discriminator patterns:**
  - P1 — single direct column (`orders.agency_id`)
  - P2 — varying column name (`campaigns.owning_agency`)
  - P3 — inherited scope via JOINs (`appointments → clients → agency`)
  - P4 — multi-level hierarchy traversal (agency → sub_agency → client)
  - P5 — polymorphic association (`notes.owner_type` + `notes.owner_id`)
- **Unified `TenantScope` input to `ask()`** — `access` (ids, subtree, multi_root, global), `context` (advisory: role, region, department)
- **Subtree expansion via a host resolver.** A `subtree` access is expanded by `ask({ resolveTenantDescendants })` into the full ID set before generation. The seeds are always unioned in. With no resolver, or an empty or invalid result, `ask()` throws `TenantScopeError` (`SUBTREE_NOT_RESOLVABLE`) instead of silently scoping to the seeds. See [`tenant-policy.md` › Subtree expansion](../contracts/tenant-policy.md#subtree-expansion).
- **Prompt assembly boundary** — policy front-matter, runtime scope, and advisory context injected into every generation prompt; named placeholder convention `:tenant_<root_label>_ids`
- **SQL guardrail validator** — heuristic predicate checks over the SQL's tokens, before tenant binding (no parser; text inside string literals and comments doesn't count): each scoped table named in the SQL, and each root table the scope covers, needs its tenant column compared with the tenant placeholder and ANDed into a filter clause (not beside an `OR`, under `NOT`, in the select list, or as a literal ID), per `UNION` branch; polymorphic tables need the id predicate plus a matching `typeColumn = '<key>'` discriminator; tables classified `unknown` are flagged. Predicates aren't tied to a specific table reference anywhere in the statement, including its CTEs, derived tables and subqueries (only set-operation branches are checked separately; #399), and cross-table scope compatibility is **not** checked
- **Enforcement modes** — `strict` (throw `TenantGuardrailError` when the heuristic check finds a problem) and `warn` (return SQL with `tenantGuardrail.warnings`). Neither mode proves a query is tenant-safe
- **SQL output modes** — `sql-only` (placeholders replaced with escaped literals, complete executable SQL) and `sql-params` (placeholders replaced with the dialect's driver markers — `$N`, `?`, or `@pN` — and the IDs returned as `tenantParams`)
- **Parameterized ask output** — when `parameterize` is on (default), business values from the question also appear as `unboundSql` / `params` / `parameters` / `preparedQuery`. Tenant placeholders remain named in `preparedQuery.namedSql` and bind via `tenantScope` (or `bindPreparedQuery` on rebind). Two executable pairs, never mixed: `sql` + `tenantParams` (business values inlined, tenant markers from the first slot) and `unboundSql` + `params` (all values bound; `params` already includes tenant IDs in marker order in `sql-params` mode). `bindPreparedQuery` does not authorize tenant IDs.
- **Fail-closed substitution** — only placeholders in SQL code are substituted (never inside string literals or quoted identifiers). A placeholder the scope has no IDs for throws `UNRESOLVED_TENANT_PLACEHOLDER`; a multi-ID scope meeting `<`, `>`, `<=`, `>=` (or another non-list position) throws `UNSUPPORTED_TENANT_PREDICATE`; `!=` / `<>` become `NOT IN`.
- **RAG propagation** — policy front-matter always injected regardless of RAG retrieval; tenant policy body chunks retrievable; scope metadata attached to scoped table chunks
- **AI-assisted policy drafting** — `@askdb/enrich` helpers analyze FK relationships and column patterns post-introspection to draft a candidate `tenant-policy.md`; human confirmation required before enforcement is enabled
- **Schema evolution handling** — new tables from re-introspection default to `unknown`; orphaned table references in policy surface as warnings

### Out of scope

- User authentication — AskDB receives authorized scope from the host; it does not authenticate users
- Multi-engine tenant proof beyond Postgres — Phase 13
- Row-level security (RLS) DDL generation — AskDB does not generate RLS policies. RLS (or equivalent database-level enforcement) is the **recommended primary tenant boundary**; AskDB's prompt instructions and guardrail are the defense-in-depth layer, not the other way round
- Built-in subtree expansion. AskDB does not generate a recursive CTE for `subtree` scopes; the host supplies `resolveTenantDescendants`. An in-database recursive-CTE strategy is a possible follow-up (#268).
- Runtime pre-resolution of polymorphic scope — polymorphic tables are declared in the policy and surfaced to the model via the prompt; there is no scope field for host-resolved polymorphic filters

## Design decisions

- **Policy at setup, scope at runtime** — the tenant model (which tables are scoped, how hierarchy works) is stable and captured once. The current user's allowed scope changes per request. These are separate inputs to `ask()`.
- **Scope is required; the SQL check is best-effort** — when a policy exists, `ask()` fails closed if no valid `tenantScope` is supplied. The guardrail is a heuristic over SQL tokens: `strict` mode throws when it finds a problem (a missing, OR-widened, negated, select-only or literal-ID predicate, among others), but passing the check does not prove the query is tenant-safe (see the limits in [`tenant-policy.md` › Guardrail validation](../contracts/tenant-policy.md#guardrail-validation)). Prompting plus the check catches common model mistakes; database-level enforcement is what actually isolates tenants. This replaces the original "strict mode fails closed on unproven queries" design; see [ADR 0012](../adrs/0012-sql-checks-are-defense-in-depth.md).
- **Validate the untrusted SQL, before rendering** — `ask()` runs the guardrail on the model's bound SQL and its `sql-unbound` block, with the `:tenant_<root>_ids` placeholders still in place, before substituting them (#315). Rendering only swaps each placeholder for literals or driver markers, so one check covers every `tenantSqlMode` and dialect. Both blocks must pass: if they disagree, the unbound extras are dropped, but a failing unbound block still fails the check. The check runs for every dialect form, including custom `AskDialect` adapters. A `tenantGuardrail` a custom adapter reports is merged in and cannot replace the check.
- **A broken policy is a load error** — only a missing `tenant-policy.md` (or, in a bundle, an absent `tenantPolicy` key) means "no tenancy". A present file or bundle value that is empty or fails to read or parse (including malformed YAML) throws `SchemaParseError`. Loading via a `schema.json` path picks up the sibling policy exactly like loading the directory.
- **Named placeholders in prompt assembly** — `:tenant_<root_label>_ids` placeholders are inserted by the model following prompt instructions, then replaced by the output modes layer. This separates prompt semantics from execution binding.
- **No silently ignored scope input** — `TenantScope.tenantFilters` (host-resolved polymorphic filters) was declared but never read, so it was removed rather than left as a field that looks like protection. For the same reason a `subtree` scope is never bound to its seed IDs alone: `ask()` expands it through `resolveTenantDescendants` or fails closed, and `resolveTenantSql()` rejects an unexpanded `subtree`.
- **Unresolvable binding fails closed** — a tenant placeholder with no IDs in scope, or a multi-ID predicate with no list form, throws instead of emitting SQL with a raw `:tenant_*` token or a rewritten operator that means something else.
- **Policy front-matter always injected with RAG** — tenant scoping in generated SQL depends on the model seeing the policy. Retrieving only a subset of schema chunks must not drop the policy context. The full policy front-matter is injected unconditionally when a policy is present.

## Contracts and API surface

**Policy format:** [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md)

```ts
// ask() tenant input
interface AskOptions {
  tenantScope?: TenantScope
  // Required for access.kind === "subtree"; returns every ID in the subtree.
  resolveTenantDescendants?: (
    tenantRoot: string,
    seedIds: readonly string[],
  ) => Promise<readonly string[]> | readonly string[]
}

interface TenantScope {
  access: TenantAccess              // ids | subtree | multi_root | global
  context?: TenantScopeContext      // advisory: role, region, department, etc.
}

// SQL output modes
interface AskOptions {
  tenantSqlMode?: 'sql-only' | 'sql-params'
}

interface AskResult {
  sql: string                       // sql-only: complete executable SQL; sql-params: run with tenantParams
  tenantParams?: unknown[]          // sql-params: tenant IDs in `sql` marker order
  unboundSql?: string               // parameterize extras: run with params
  params?: QueryParamSlot[]         // all values for unboundSql (tenant IDs included in sql-params)
  tenantBindings?: TenantBinding[]
  tenantGuardrail?: TenantGuardrailResult  // { passed, warnings }; warnings populated in warn mode
}
```

`tenant-policy.md` front-matter shape:
```yaml
---
schemaId: my-app
enforcement: strict
roots:
  - id: table:public.agencies
    tenantIdColumn: table:public.agencies#id
    label: Agency
  - id: table:public.sub_agencies
    tenantIdColumn: table:public.sub_agencies#id
    label: Sub-Agency
    parent:
      root: table:public.agencies
      foreignKey: table:public.sub_agencies#agency_id
hierarchy:
  - parent: table:public.agencies
    child: table:public.sub_agencies
    foreignKey: table:public.sub_agencies#agency_id
scopedTables:
  - id: table:public.orders
    scopeThrough:
      - root: table:public.agencies
        column: table:public.orders#agency_id
---
```

See [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md) for the full field reference.

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- All pre-Phase 10 tests remain green; prompt snapshots for schemas without tenant policy are byte-identical.
- Policy loading: fixture `tenant-policy.md` loads and normalizes deterministically; unknown table IDs, broken FK paths, and cycles produce clear validation errors. Malformed YAML front-matter throws `SchemaParseError`; a missing file loads with no policy; a `schema.json` path loads the sibling policy.
- SQL guardrail on returned SQL: a model reply whose `sql` block is unscoped but whose `sql-unbound` block is scoped fails in strict mode and reports warnings in warn mode. A custom `AskDialect` returning unscoped SQL under a strict policy is rejected.
- All five discriminator patterns (P1–P5) covered by fixture tests.
- `ask()` without scope when a policy is configured fails before model generation.
- `subtree` scope: the resolver's full ID set reaches the SQL (seeds unioned in). With no resolver, or an empty or invalid result, `ask()` throws `SUBTREE_NOT_RESOLVABLE` before model generation. Closure expansion terminates on cyclic hierarchies.
- `ask()` with valid agency scope proceeds to prompt assembly; golden prompt snapshot includes policy block, scope, and advisory context.
- SQL guardrail: SQL that names a scoped table without an `agency_id = :tenant_agency_ids` predicate ANDed into its filter (including the column only selected, a literal ID, or an OR-widened predicate) throws in strict mode and warns in warn mode; SQL with the predicate passes; a polymorphic table without a matching type discriminator fails; unknown tables are flagged. (Cross-tenant JOIN compatibility is not checked.)
- `sql-only` mode returns complete executable SQL; `sql-params` returns `{ sql, tenantParams }` with dialect-correct markers; both are rendered from SQL that passed the guardrail validator (the rendered forms themselves no longer pass it, because their placeholders are gone).
- Tenant binding executes: for Postgres, MySQL, SQLite, and SQL Server output, `sql` + `tenantParams` and `unboundSql` + `params` both run on SQLite (better-sqlite3) and return the scoped rows; zero-ID placeholders and multi-ID `<=` throw; placeholder text inside string literals is untouched and a crafted tenant ID cannot leave its literal.
- RAG-backed prompts: full tenant policy front-matter present regardless of retrieved chunks; body chunks retrieved when relevant; generated SQL validated against scope.
- Studio: sample ask with mock scope input returns scoped SQL; removing scope returns a policy error; enforcement mode toggle is reflected in the response.
