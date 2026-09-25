# Feature: Multi-Tenancy

**Status:** Complete  
**Packages:** `@askdb/core` (policy loading, prompt assembly, SQL validation, output modes), `@askdb/enrich` (authoring helpers), `apps/studio` (UI), `apps/cli` (scope input), `apps/http-api` (scope input)

## Overview

Multi-tenancy support steers AskDB toward generating SQL that is scoped to the current user's authorized tenant boundary. The tenant model is captured once at setup time in a `tenant-policy.md` artifact (alongside `schema.json` in the schema directory), and the current user's authorized scope is passed to `ask()` at runtime via `TenantScope`.

Prompt assembly includes the full policy and scope in every generation request. After generation, a heuristic SQL guardrail checks that, for every tenant-scoped table named in the SQL, the expected tenant column (or join-path columns, or the `:tenant_*_ids` placeholder) appears somewhere in the statement. It does not parse SQL or verify that the identifier sits in a filtering predicate — `... OR 1=1`, a tenant column that is only selected, or a negated predicate all pass. If the policy is configured in `strict` mode, a failed check throws `TenantGuardrailError`; in `warn` mode, the SQL is returned with `tenantGuardrail.warnings` and the host decides.

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
- **Unified `TenantScope` input to `ask()`** — `access` (ids, multi_root, global; `subtree` is declared but rejected until descendant expansion exists), `context` (advisory: role, region, department)
- **Prompt assembly boundary** — policy front-matter, runtime scope, and advisory context injected into every generation prompt; named placeholder convention `:tenant_<root_label>_ids`
- **SQL guardrail validator** — heuristic identifier-presence checks over SQL code (no parser; string literals and comments are ignored): each scoped table named in the SQL must be accompanied by its tenant column, join-path columns, or tenant placeholder somewhere in the statement; polymorphic tables must mention the type discriminator and id columns; tables classified `unknown` are flagged. Clause position, `OR`/negation, and cross-table scope compatibility are **not** checked
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
- Subtree expansion — the `subtree` scope kind is rejected with `TenantScopeError` (`UNSUPPORTED_ACCESS_KIND`) because descendants are never expanded; the host resolves the subtree and passes explicit IDs with `ids` / `multi_root`
- Runtime pre-resolution of polymorphic scope — polymorphic tables are declared in the policy and surfaced to the model via the prompt; there is no scope field for host-resolved polymorphic filters

## Design decisions

- **Policy at setup, scope at runtime** — the tenant model (which tables are scoped, how hierarchy works) is stable and captured once. The current user's allowed scope changes per request. These are separate inputs to `ask()`.
- **Scope is required; the SQL check is best-effort** — when a policy exists, `ask()` fails closed if no valid `tenantScope` is supplied. The post-generation guardrail is a heuristic lint: `strict` mode throws when it finds a problem, but passing the check does not prove the query is tenant-safe. Prompting plus the lint catches common model mistakes; database-level enforcement is what actually isolates tenants.
- **Validate what is returned** — `ask()` runs the guardrail on `result.sql` after tenant placeholder substitution, plus `result.unboundSql` when it is kept. It never validates only the model's `sql-unbound` block: if the bound and unbound blocks disagree, the unbound extras are dropped and the bound SQL alone decides. The check runs for every dialect form, including custom `AskDialect` adapters. A `tenantGuardrail` a custom adapter reports is merged in and cannot replace the check.
- **A broken policy is a load error** — only a missing `tenant-policy.md` (or, in a bundle, an absent `tenantPolicy` key) means "no tenancy". A present file or bundle value that is empty or fails to read or parse (including malformed YAML) throws `SchemaParseError`. Loading via a `schema.json` path picks up the sibling policy exactly like loading the directory.
- **Named placeholders in prompt assembly** — `:tenant_<root_label>_ids` placeholders are inserted by the model following prompt instructions, then replaced by the output modes layer. This separates prompt semantics from execution binding.
- **No silently ignored scope input** — `TenantScope.tenantFilters` (host-resolved polymorphic filters) was declared but never read, so it was removed rather than left as a field that looks like protection. `subtree` is rejected for the same reason: accepting it would under-return without any signal.
- **Unresolvable binding fails closed** — a tenant placeholder with no IDs in scope, or a multi-ID predicate with no list form, throws instead of emitting SQL with a raw `:tenant_*` token or a rewritten operator that means something else.
- **Policy front-matter always injected with RAG** — tenant scoping in generated SQL depends on the model seeing the policy. Retrieving only a subset of schema chunks must not drop the policy context. The full policy front-matter is injected unconditionally when a policy is present.

## Contracts and API surface

**Policy format:** [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md)

```ts
// ask() tenant input
interface AskOptions {
  tenantScope?: TenantScope
}

interface TenantScope {
  access: TenantAccess              // ids | multi_root | global (subtree: rejected for now)
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
  tenantGuardrail?: TenantGuardrailResult  // { passed, warnings } — warnings populated in warn mode
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
- `ask()` with valid agency scope proceeds to prompt assembly; golden prompt snapshot includes policy block, scope, and advisory context.
- SQL guardrail: SQL that names a scoped table without mentioning `agency_id` (or the placeholder) in SQL code throws in strict mode and warns in warn mode; SQL mentioning the tenant column passes; polymorphic table without type discriminator fails; unknown tables are flagged. (Cross-tenant JOIN compatibility is not checked.)
- `sql-only` mode returns complete executable SQL; `sql-params` returns `{ sql, tenantParams }` with dialect-correct markers; both pass the guardrail validator.
- Tenant binding executes: for Postgres, MySQL, SQLite, and SQL Server output, `sql` + `tenantParams` and `unboundSql` + `params` both run on SQLite (better-sqlite3) and return the scoped rows; zero-ID placeholders, multi-ID `<=`, and `subtree` scope throw; placeholder text inside string literals is untouched and a crafted tenant ID cannot leave its literal.
- RAG-backed prompts: full tenant policy front-matter present regardless of retrieved chunks; body chunks retrieved when relevant; generated SQL validated against scope.
- Studio: sample ask with mock scope input returns scoped SQL; removing scope returns a policy error; enforcement mode toggle is reflected in the response.
