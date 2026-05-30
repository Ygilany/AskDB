# Feature: Multi-Tenancy

**Status:** Complete  
**Packages:** `@askdb/core` (policy loading, prompt assembly, SQL validation, output modes), `@askdb/enrich` (authoring helpers), `apps/studio` (UI), `apps/cli` (scope input), `apps/http-api` (scope input)

## Overview

Multi-tenancy support ensures AskDB generates SQL that is correctly scoped to the current user's authorized tenant boundary. The tenant model is captured once at setup time in a `tenant-policy.md` artifact (alongside `schema.json` in the schema directory), and the current user's authorized scope is passed to `ask()` at runtime via `TenantScope`.

Prompt assembly includes the full policy and scope in every generation request. After generation, a SQL guardrail validator checks that the generated SQL contains the required tenant predicates for every tenant-scoped table. If the policy is configured in `strict` mode, unsafe SQL fails closed; in `warn` mode, the SQL is returned with a `tenantWarnings` array and the host decides.

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
- **Unified `TenantScope` input to `ask()`** — `access` (ids, subtree, multi_root, global), `tenantFilters` (polymorphic overrides, host-resolved), `context` (advisory: role, region, department)
- **Prompt assembly boundary** — policy front-matter, runtime scope, and advisory context injected into every generation prompt; named placeholder convention `:tenant_<root_label>_ids`
- **SQL guardrail validator** — AST-based Postgres SQL checks: scoped tables must have required predicates; polymorphic tables must include type discriminator; cross-table scope compatibility checked
- **Enforcement modes** — `strict` (fail closed on unproven queries) and `warn` (return SQL with `tenantWarnings`)
- **SQL output modes** — `sql-only` (placeholders replaced with literals, complete executable SQL) and `sql-params` (positional parameters `$1, $2`, returns `{ sql, params, tenantBindings }`)
- **RAG propagation** — policy front-matter always injected regardless of RAG retrieval; tenant policy body chunks retrievable; scope metadata attached to scoped table chunks
- **AI-assisted policy drafting** — `@askdb/enrich` helpers analyze FK relationships and column patterns post-introspection to draft a candidate `tenant-policy.md`; human confirmation required before enforcement is enabled
- **Schema evolution handling** — new tables from re-introspection default to `unknown`; orphaned table references in policy surface as warnings

### Out of scope

- User authentication — AskDB receives authorized scope from the host; it does not authenticate users
- Multi-engine tenant proof beyond Postgres — Phase 13
- Row-level security (RLS) DDL generation — tenant predicates are SQL WHERE clauses; RLS is still recommended as a defense-in-depth layer
- Subtree expansion — `subtree` scope kind is accepted but host must expand to explicit IDs in practice

## Design decisions

- **Policy at setup, scope at runtime** — the tenant model (which tables are scoped, how hierarchy works) is stable and captured once. The current user's allowed scope changes per request. These are separate inputs to `ask()`.
- **Strict mode fails closed** — when the guardrail validator cannot prove a query is tenant-safe, it rejects. Prompting alone is not sufficient; SQL validation is the second line of defense.
- **Named placeholders in prompt assembly** — `:tenant_<root_label>_ids` placeholders are inserted by the model following prompt instructions, then replaced by the output modes layer. This separates prompt semantics from execution binding.
- **Host expands polymorphic filters** — for polymorphic tables, the host resolves which specific record IDs the user can access and passes them as `tenantFilters`. AskDB applies the type discriminator and resolved filters; it does not perform identity resolution.
- **Policy front-matter always injected with RAG** — tenant safety is a security boundary. Retrieving only a subset of schema chunks must not drop the policy context. The full policy front-matter is injected unconditionally when a policy is present.

## Contracts and API surface

**Policy format:** [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md)

```ts
// ask() tenant input
interface AskOptions {
  tenantScope?: TenantScope
}

interface TenantScope {
  access: TenantAccess              // ids | subtree | multi_root | global
  tenantFilters?: TenantFilter[]    // polymorphic overrides (host-resolved)
  context?: TenantContext           // advisory: role, region, department, etc.
}

// SQL output modes
interface AskOptions {
  sqlOutputMode?: 'sql-only' | 'sql-params'
}

interface AskResult {
  sql: string                       // sql-only: complete executable SQL
  params?: SqlParams                // sql-params: positional params
  tenantBindings?: TenantBindings
  tenantWarnings?: TenantWarning[]  // warn mode: scope issues found
}
```

`tenant-policy.md` front-matter shape:
```yaml
---
roots:
  - tableId: table:public.agencies
    tenantColumn: id
hierarchy:
  - parentId: table:public.agencies
    childId: table:public.sub_agencies
    foreignKey: agency_id
scopedTables:
  - tableId: table:public.orders
    pattern: direct
    tenantColumn: agency_id
enforcement: strict
---
```

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- All pre-Phase 10 tests remain green; prompt snapshots for schemas without tenant policy are byte-identical.
- Policy loading: fixture `tenant-policy.md` loads and normalizes deterministically; unknown table IDs, broken FK paths, and cycles produce clear validation errors.
- All five discriminator patterns (P1–P5) covered by fixture tests.
- `ask()` without scope when a policy is configured fails before model generation.
- `ask()` with valid agency scope proceeds to prompt assembly; golden prompt snapshot includes policy block, scope, and advisory context.
- SQL guardrail: missing `agency_id` predicate fails closed in strict mode; correctly scoped SQL passes; polymorphic table without type discriminator fails; cross-tenant JOIN fails.
- `sql-only` mode returns complete executable SQL; `sql-params` returns `{ sql, params }` with positional parameters; both pass the guardrail validator.
- RAG-backed prompts: full tenant policy front-matter present regardless of retrieved chunks; body chunks retrieved when relevant; generated SQL validated against scope.
- Studio: sample ask with mock scope input returns scoped SQL; removing scope returns a policy error; enforcement mode toggle is reflected in the response.
