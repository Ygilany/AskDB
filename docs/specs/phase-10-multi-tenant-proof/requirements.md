# Phase 10 — Multi-tenant proof (requirements)

Status: Draft

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

AskDB already treats sensitive fields and operating modes as explicit contracts, and Schema v2 lets teams enrich database structure with business meaning. The next correctness boundary is tenancy: many customers will point AskDB at a database that contains data for multiple agencies, sub-agencies, clients, accounts, stores, or other organizational units.

For those databases, "generate valid SQL" is not enough. AskDB must know which tables are tenant-scoped, how scope propagates across relationships, and what the current user is allowed to see. That policy must be captured during setup, passed into `ask()` at runtime, included in prompt assembly, and checked after SQL generation.

This phase proves that path on Postgres before additional database engines are added.

## Problem

Without Phase 10:

- **Tenant boundaries are implicit** — column names like `tenant_id`, `agency_id`, or `organization_id` may exist, but AskDB has no confirmed policy for which one is authoritative.
- **Hierarchies are common** — an agency may own sub-agencies, and those sub-agencies may own clients/accounts. A user's scope may be a subtree, not a single id.
- **Prompt-only enforcement is weak** — telling the model to be careful is not a security boundary. Generated SQL must be validated and must fail closed when tenant predicates are missing.
- **RAG can drop policy context** — focused retrieval may surface a table chunk without the tenant graph needed to constrain it.
- **Hosts need a typed integration point** — the application embedding AskDB must pass the current user's authorized scope in a structured way, not as free-text prompt instructions.

## Scope (in)

### 1) Tenant policy metadata

Extend the Schema v2 artifact with an optional tenant policy section. Exact file location is decided during implementation, but the contract should support either `schema.json` metadata or a colocated policy file if that keeps Schema v2 cleaner.

The policy must represent:

- tenant roots: canonical tenant tables/entities, e.g. `agencies`
- tenant identifier columns, e.g. `agency_id`, `tenant_id`, `organization_id`
- scoped tables: tables whose rows are constrained by one or more tenant roots
- propagation paths: how scope reaches child tables through direct columns or foreign-key joins
- hierarchy edges: parent/child relationships such as agency -> sub-agency -> client/account
- bypass semantics: whether an explicit admin/global scope is supported, and how it must be named

The policy is explicit. Introspection may suggest likely tenant columns, but AskDB must not enable tenant enforcement from name heuristics alone.

### 2) Setup-time capture

Studio and TUI should guide the integrator through tenant setup:

- identify whether the schema is multi-tenant
- confirm tenant root table(s)
- confirm direct tenant columns on operational tables
- confirm inherited scope paths through foreign keys
- confirm hierarchy semantics for parent/child tenant structures
- preview which tables are tenant-scoped, unscoped, or unknown
- save the confirmed policy with the schema artifact

The first proof can be a focused flow; it does not need a full visual policy editor.

### 3) Runtime access scope

Add a typed runtime input to `ask()` for the current user's authorized tenant scope.

The shape should support at least:

```ts
type TenantAccessScope =
  | {
      kind: "tenant_ids";
      tenantRoot: string;
      ids: string[];
    }
  | {
      kind: "tenant_subtree";
      tenantRoot: string;
      rootIds: string[];
      includeDescendants: true;
    }
  | {
      kind: "tenant_ids_by_root";
      roots: Record<string, string[]>;
    }
  | {
      kind: "global";
      reason: string;
    };
```

Implementation may refine the names, but the contract must distinguish exact-id access, subtree access, multi-root access, and explicit global/admin access.

### 4) Prompt boundary

Prompt assembly must include a compact tenant policy block when a tenant policy is present:

- tenant roots and hierarchy rules
- scoped tables and required predicate/join paths
- the current user's runtime scope
- a clear instruction that every tenant-scoped table must be constrained to the user's scope
- the expected placeholder or literal style for scope predicates

Prefer parameter placeholders over embedding raw ids in SQL whenever the core output contract can support it. If the proof keeps SQL-only output, validation must still ensure the generated SQL constrains to the supplied runtime scope.

### 5) SQL guardrails

Generated SQL must be checked after model output:

- If a schema has tenant policy and the host did not pass `tenantScope`, fail closed.
- If a query touches a tenant-scoped table without the required tenant predicate or join path, reject it.
- If a query joins multiple tenant-scoped tables, validate that their tenant scopes are compatible.
- If the user asks for cross-tenant or global data without an explicit `global` scope, reject it or return a clear policy error.
- If validation cannot prove scope safety, reject the SQL.

This phase can start with conservative validation for common Postgres `SELECT` patterns. It should prefer false negatives over false positives.

### 6) RAG propagation

RAG indexing and retrieval must preserve tenant policy context:

- tenant metadata should be available to prompt assembly even when only a subset of schema chunks is retrieved
- chunks for tenant-scoped tables should carry enough metadata to identify required scope roots
- retrieved DDL synthesis must include tenant policy context for every scoped table in the focused prompt

### 7) Fixture and examples

Add a representative fixture with nested tenancy:

- `agencies`
- `sub_agencies` or parent agencies
- `clients` / `accounts`
- operational tables such as orders, invoices, leads, campaigns, or appointments
- a mix of direct tenant columns and inherited tenant scope through joins
- at least one global/reference table that is intentionally unscoped

The fixture should exercise agency-level access, sub-agency access, subtree access, cross-tenant denial, and explicit global/admin access.

## Scope (out)

- **Production policy engine** — this phase proves the contract and validator; deeper policy composition lands in the later production-depth phase.
- **Replacing host authorization** — AskDB does not become the source of truth for who a user is or which tenants they may access. The host passes the authorized scope.
- **Replacing database RLS** — applications should still use database row-level security or equivalent controls for production enforcement. AskDB's generated SQL guardrails are an additional safety layer, not the only one.
- **All SQL shapes** — v0 may reject complex queries it cannot prove safe.
- **All database engines** — this phase is Postgres-first; Phase 11 ports the proof deliberately per engine.
- **Raw row-data policy** — `bounded_results` summarization remains Phase 12 work.

## Spec decisions

| Topic | Decision |
|---|---|
| Phase placement | Phase 10, before additional database engines. |
| First engine | Postgres only for the proof. |
| Policy source | Explicit tenant policy saved with the schema artifact; no heuristic-only enforcement. |
| Setup UX | Studio/TUI prompts integrators to confirm tenant roots, scoped tables, paths, and hierarchy. |
| Runtime scope | Typed `tenantScope` input to `ask()`, supplied by the host. |
| Prompt strategy | Include policy + current scope in prompt assembly when tenant policy exists. |
| Guardrail strategy | Validate generated SQL and fail closed when scope cannot be proven. |
| RAG | Tenant policy must survive focused retrieval and synthesized DDL prompts. |
| Admin/global | Allowed only through an explicit runtime scope kind, never inferred from the natural-language question. |

## Open choices

- Exact tenant policy storage: inline `schema.json`, new `tenant-policy.json`, or Schema v2 describable metadata.
- Whether `ask()` should return SQL plus parameters/bindings as part of this phase, or keep SQL-only output for the proof.
- How much SQL parsing to introduce for guardrails: existing heuristics, a Postgres parser dependency, or a narrow local AST pass.
- How to represent subtree scopes without forcing AskDB to know every descendant id. Options include host-expanded ids, recursive CTE generation, or a confirmed hierarchy join path.
- Whether Studio/TUI should include a policy "coverage report" that lists every table as scoped, inherited, global, or unknown.
- How tenant policy interacts with sensitive-field omission in prompts.

## Success

After Phase 10:

1. An integrator can mark a schema as multi-tenant, confirm an agency/sub-agency hierarchy, and save that policy with the Schema v2 artifact.
2. A host can call `ask()` with a typed tenant scope for the current user.
3. Prompt assembly includes tenant policy and runtime scope in both full-schema and RAG-backed prompts.
4. Generated SQL for tenant-scoped questions includes the required tenant predicates or join paths.
5. Unsafe SQL is rejected when the model omits scope, when the host omits scope, or when the requested question requires broader access than the user has.
6. Tests prove direct tenant ids, nested agency subtrees, inherited joins, unscoped reference tables, and explicit global/admin scope.

## References

- [`docs/roadmap.md`](../../roadmap.md) — Phase 10
- [`docs/mission.md`](../../mission.md) — multi-tenant success criterion
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 artifact this phase extends
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — source of physical schema and FK paths
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — terminal authoring surface
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — focused retrieval path
- [`docs/specs/phase-9-studio-revamp/`](../phase-9-studio-revamp/) — browser authoring surface
