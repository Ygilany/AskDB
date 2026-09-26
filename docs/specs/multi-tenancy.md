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
- **Unified `TenantScope` input to `ask()`** — `access` (ids, subtree, multi_root, global), `tenantFilters` (accepted and shape-validated, but **not read by any code today** — see plan 048), `context` (advisory: role, region, department)
- **Prompt assembly boundary** — policy front-matter, runtime scope, and advisory context injected into every generation prompt; named placeholder convention `:tenant_<root_label>_ids`
- **SQL guardrail validator** — heuristic identifier-presence checks over the SQL text (no parser): each scoped table named in the SQL must be accompanied by its tenant column, join-path columns, or tenant placeholder somewhere in the statement; polymorphic tables must mention the type discriminator and id columns; tables classified `unknown` are flagged. Clause position, `OR`/negation, and cross-table scope compatibility are **not** checked
- **Enforcement modes** — `strict` (throw `TenantGuardrailError` when the heuristic check finds a problem) and `warn` (return SQL with `tenantGuardrail.warnings`). Neither mode proves a query is tenant-safe
- **SQL output modes** — `sql-only` (placeholders replaced with literals, complete executable SQL) and `sql-params` (positional parameters `$1, $2`, returns `{ sql, params, tenantBindings }`)
- **Parameterized ask output** — when `parameterize` is on (default), business values from the question also appear as `unboundSql` / `params` / `parameters` / `preparedQuery`. Tenant placeholders remain named in `preparedQuery.namedSql` and bind via `tenantScope` (or `bindPreparedQuery` on rebind). Prefer `params` over `tenantParams` when using the new fields. `bindPreparedQuery` does not authorize tenant IDs.
- **RAG propagation** — policy front-matter always injected regardless of RAG retrieval; tenant policy body chunks retrievable; scope metadata attached to scoped table chunks
- **AI-assisted policy drafting** — `@askdb/enrich` helpers analyze FK relationships and column patterns post-introspection to draft a candidate `tenant-policy.md`; human confirmation required before enforcement is enabled
- **Schema evolution handling** — new tables from re-introspection default to `unknown`; orphaned table references in policy surface as warnings

### Out of scope

- User authentication — AskDB receives authorized scope from the host; it does not authenticate users
- Multi-engine tenant proof beyond Postgres — Phase 13
- Row-level security (RLS) DDL generation — AskDB does not generate RLS policies. RLS (or equivalent database-level enforcement) is the **recommended primary tenant boundary**; AskDB's prompt instructions and guardrail are the defense-in-depth layer, not the other way round
- Subtree expansion — `subtree` scope kind is accepted, and the prompt asks the model to include descendants, but only `rootIds` are bound into the tenant placeholders. Hosts must expand descendants to explicit IDs (plan 047 tracks real expansion)

## Design decisions

- **Policy at setup, scope at runtime** — the tenant model (which tables are scoped, how hierarchy works) is stable and captured once. The current user's allowed scope changes per request. These are separate inputs to `ask()`.
- **Scope is required; the SQL check is best-effort** — when a policy exists, `ask()` fails closed if no valid `tenantScope` is supplied. The post-generation guardrail is a heuristic lint: `strict` mode throws when it finds a problem, but passing the check does not prove the query is tenant-safe. Prompting plus the lint catches common model mistakes; database-level enforcement is what actually isolates tenants.
- **Named placeholders in prompt assembly** — `:tenant_<root_label>_ids` placeholders are inserted by the model following prompt instructions, then replaced by the output modes layer. This separates prompt semantics from execution binding.
- **Polymorphic filters (not implemented)** — the original design had the host resolve accessible record IDs for polymorphic tables and pass them as `tenantFilters`. `tenantFilters` is accepted by the `TenantScope` type and zod schema but nothing reads it: it does not reach the prompt, the guardrail, or the returned SQL. Plan 048 proposes removing it. AskDB does not perform identity resolution.
- **Policy front-matter always injected with RAG** — tenant scoping in generated SQL depends on the model seeing the policy. Retrieving only a subset of schema chunks must not drop the policy context. The full policy front-matter is injected unconditionally when a policy is present.

## Contracts and API surface

**Policy format:** [`docs/contracts/tenant-policy.md`](../contracts/tenant-policy.md)

```ts
// ask() tenant input
interface AskOptions {
  tenantScope?: TenantScope
}

interface TenantScope {
  access: TenantAccess                          // ids | subtree | multi_root | global
  tenantFilters?: Record<string, TenantFilter>  // accepted but currently unused (plan 048)
  context?: TenantScopeContext                  // advisory: role, region, department, etc.
}

// SQL output modes
interface AskOptions {
  tenantSqlMode?: 'sql-only' | 'sql-params'
}

interface AskResult {
  sql: string                               // sql-only: complete executable SQL
  tenantParams?: unknown[]                  // sql-params: tenant-only positional params
  tenantBindings?: TenantBinding[]
  tenantGuardrail?: TenantGuardrailResult   // { passed, warnings } — warnings populated in warn mode
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
- Policy loading: fixture `tenant-policy.md` loads and normalizes deterministically; unknown table IDs, broken FK paths, and cycles produce clear validation errors.
- All five discriminator patterns (P1–P5) covered by fixture tests.
- `ask()` without scope when a policy is configured fails before model generation.
- `ask()` with valid agency scope proceeds to prompt assembly; golden prompt snapshot includes policy block, scope, and advisory context.
- SQL guardrail: SQL that names a scoped table without mentioning `agency_id` (or the placeholder) throws in strict mode and warns in warn mode; SQL mentioning the tenant column passes; polymorphic table without type discriminator fails; unknown tables are flagged. (Cross-tenant JOIN compatibility is not checked.)
- `sql-only` mode returns complete executable SQL; `sql-params` returns `{ sql, params }` with positional parameters; both pass the guardrail validator.
- RAG-backed prompts: full tenant policy front-matter present regardless of retrieved chunks; body chunks retrieved when relevant; generated SQL validated against scope.
- Studio: sample ask with mock scope input returns scoped SQL; removing scope returns a policy error; enforcement mode toggle is reflected in the response.
