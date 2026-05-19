# Phase 10 — Multi-tenant proof (requirements)

Status: Draft (refined)

See also **[`plan.md`](./plan.md)** (milestones), **[`validation.md`](./validation.md)** (merge bar), and **[`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md)** (format contract).

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
- **User context matters** — the same question means different things depending on who is asking. A host must be able to pass advisory context (role, region, department) alongside the enforceable scope.

## Real-world discriminator patterns

The tenant policy model must support these patterns, all confirmed in real-world schemas:

| Pattern | Description | Example |
|---|---|---|
| **P1: Single direct column** | Same tenant FK column name on all scoped tables. | `orders.agency_id`, `invoices.agency_id` |
| **P2: Varying column names** | Different FK column names per table, same tenant root. | `orders.agency_id`, `campaigns.owning_agency` |
| **P3: Inherited via JOINs** | Table has no tenant column; scope inherited through FK chain. | `order_items` → `orders.agency_id` |
| **P4: Multi-level hierarchy** | Tenant scope spans hierarchy levels requiring traversal. | `appointments.client_id` → `clients.sub_agency_id` → `sub_agencies.agency_id` |
| **P5: Polymorphic association** | Type + id column pair; same column points to different tenant levels. | `notes.owner_type` = 'agency' \| 'sub_agency' \| 'client', `notes.owner_id` |

Composite tenant keys (multiple columns together defining the boundary) are less likely but possible; the model should not block them even if Phase 10 does not fully validate them.

## Scope (in)

### 1) Tenant policy metadata — `tenant-policy.md`

Add a `tenant-policy.md` file to the Schema v2 directory, following the `concepts.md` pattern: YAML front-matter for machine-readable policy, markdown body for human-readable business context.

See **[`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md)** for the full format contract.

The policy must represent:

- **tenant roots**: canonical tenant tables/entities (e.g., `agencies`, `sub_agencies`, `clients`)
- **tenant identifier columns**: the id column on each root (e.g., `agencies.id`)
- **hierarchy edges**: parent/child relationships between roots (e.g., agency → sub-agency → client) with the FK that connects them
- **scoped tables**: tables whose rows are constrained by one or more tenant roots, specifying whether scope is via a direct column or an inherited JOIN path
- **polymorphic tables**: tables using type + id column pairs, with a mapping from type discriminator values to tenant root tables
- **global/unscoped tables**: explicitly listed reference/lookup tables that never need tenant filtering
- **unknown tables**: tables not yet classified — the system warns about these and strict mode blocks queries touching them
- **enforcement mode**: `strict` (reject unproven queries) or `warn` (flag but return SQL), configurable per schema

The policy is explicit. Introspection may suggest likely tenant columns, but AskDB must not enable tenant enforcement from name heuristics alone.

### 2) Setup-time capture (AI-assisted with explicit confirmation)

Studio and TUI should guide the integrator through tenant setup:

**AI-assisted drafting:**
- After introspection, analyze FK relationships, column naming patterns, self-referential tables, and polymorphic patterns
- Generate a draft `tenant-policy.md` with the AI's best guess at tenant structure
- Present the draft for review

**Explicit per-section confirmation:**
- Is this schema multi-tenant?
- Confirm tenant root table(s) and their hierarchy
- Confirm direct tenant columns on operational tables (P1, P2)
- Confirm inherited scope paths through foreign keys (P3)
- Confirm hierarchy semantics for parent/child tenant structures (P4)
- Confirm polymorphic table mappings if any (P5)
- Confirm which tables are intentionally global/unscoped
- Review coverage report: every table classified as scoped / inherited / global / unknown
- Confirm enforcement mode (strict / warn)

Each section requires explicit confirmation before the policy is saved. Unknown tables are explicitly tracked — no table is silently skipped.

**Business context authoring:**
- The integrator writes or reviews the markdown body describing the tenancy model in business terms
- The AI can suggest a draft based on the structure, but the integrator owns the prose

### 3) Runtime tenant scope — unified `TenantScope` input

Add a typed `tenantScope` option to `ask()` that carries both **enforceable access** and **advisory context** in a single structured object.

```ts
interface TenantScope {
  // === Enforced by guardrails ===
  access:
    | {
        kind: "ids";
        tenantRoot: string;       // stable table ID, e.g., "table:public.agencies"
        ids: string[];            // tenant IDs the user can access
      }
    | {
        kind: "subtree";
        tenantRoot: string;
        rootIds: string[];
        includeDescendants: true;
      }
    | {
        kind: "multi_root";
        scopes: Array<{
          tenantRoot: string;
          ids: string[];
        }>;
      }
    | {
        kind: "global";
        reason: string;           // audit trail, e.g., "super_admin"
      };

  // Optional: polymorphic table overrides (host-resolved)
  tenantFilters?: Record<string, TenantFilter>;

  // === Advisory (used by LLM, not enforced) ===
  context?: {
    role?: string;              // e.g., "regional_manager", "frontline_worker"
    label?: string;             // e.g., "Jane Smith, Northeast Agency"
    department?: string;        // e.g., "sales", "operations"
    region?: string;            // e.g., "northeast", "west_coast"
    attributes?: Record<string, string>;  // additional freeform key-value pairs
    description?: string;       // freeform prose, e.g., "Manages 3 sub-agencies in NE"
  };
}
```

**Enforcement model:**

| Field | Guardrails | Prompt | Logged |
|---|---|---|---|
| `access` | Validated. SQL rejected if scope violated. | Compact scope block. | Scope kind + root (no IDs unless opted in). |
| `tenantFilters` | Checked for presence on polymorphic tables. | Included as additional constraints. | Filter table IDs only. |
| `context` | Not enforced. | Included as advisory user context. | Role only (no PII). |

**Scope resolution responsibility (hybrid model):**
- AskDB stores hierarchy metadata (for prompt context and LLM understanding)
- The host chooses the resolution strategy:
  - **Pre-expanded IDs** (`kind: "ids"` or `kind: "multi_root"`): host resolves hierarchy and passes flat ID lists. This is the Phase 10 default.
  - **Subtree scope** (`kind: "subtree"`): host passes root IDs and AskDB can generate hierarchy traversal SQL. Phase 10 documents this path; full CTE generation may follow in a later phase.
- Multi-level access (user scoped at different hierarchy levels) is supported via `kind: "multi_root"`

### 4) Prompt boundary

Prompt assembly must include tenant context when a tenant policy is present. Two categories of content with different inclusion rules:

**Always injected (security boundary):**
- Tenant policy front-matter: roots, hierarchy, scoped tables, propagation paths, polymorphic mappings, global tables, enforcement mode
- Runtime scope: the current user's `access` kind and tenant constraints
- Clear instruction: every tenant-scoped table must be constrained to the current user's scope
- Expected SQL style for tenant predicates (named placeholders)

**Chunked for RAG retrieval (enrichment):**
- Tenant policy markdown body: business context, scope rule descriptions, sensitive interactions
- Retrieved when relevant to improve LLM understanding

**Prompt instructions must specify:**
- Named placeholder convention: `:tenant_<root_label>_ids` for tenant predicates
- That polymorphic tables require the type discriminator column in WHERE clauses
- That global/reference tables do not need tenant predicates
- That unknown tables should not be queried (strict mode) or should trigger a warning (warn mode)

### 5) SQL output modes

`ask()` supports two output modes, configurable by the host:

**SQL-only mode (default for Phase 10 proof):**
- LLM generates SQL with named placeholders for tenant predicates
- AskDB replaces placeholders with literal values before returning
- Returned SQL is complete and executable

**SQL + params mode:**
- LLM generates SQL with named placeholders
- AskDB returns `{ sql, params, tenantBindings }` where `sql` contains positional parameters (`$1`, `$2`) and `params`/`tenantBindings` contain the bound values
- Host executes the parameterized query directly

### 6) SQL guardrails

Generated SQL must be checked after model output using a **parser + heuristic fallback** strategy:

**Primary: SQL parser (`node-sql-parser` or equivalent)**
- Parse generated SQL into an AST
- Identify referenced tables and their aliases
- For each tenant-scoped table, verify the required tenant predicate or validated inherited join path exists
- Verify cross-table tenant scope compatibility on JOINs (prevent mismatched scopes)
- Check polymorphic tables have the type discriminator in WHERE clauses

**Fallback: conservative rejection**
- If the parser cannot handle the SQL shape, apply heuristic checks
- If neither parser nor heuristics can prove scope safety, reject the query (strict) or flag it (warn)

**Specific rules:**
- If a schema has tenant policy and the host did not pass `tenantScope`, fail closed
- If a query touches a tenant-scoped table without the required tenant predicate or join path, reject it
- If a query joins multiple tenant-scoped tables, validate that their tenant scopes are compatible
- If a query touches an `unknown` table: reject (strict) or warn (warn mode)
- Aggregation queries across tenant boundaries are allowed when the user's scope covers the aggregated set; unrestricted aggregation requires `global` scope
- If the user asks for cross-tenant or global data without an explicit `global` scope, reject or warn
- If validation cannot prove scope safety, reject the SQL (strict) or flag it (warn)

**Enforcement mode is configurable per schema:**
- `strict`: reject unproven queries. False positives preferred over false negatives.
- `warn`: return the SQL with a `tenantWarnings` array. The host decides whether to execute.

### 7) RAG propagation

RAG indexing and retrieval must preserve tenant policy context with a dual strategy:

**Always injected (not dependent on retrieval):**
- Tenant policy front-matter (structural data) is always included in prompts. This is a security boundary — it cannot be lost through chunking or retrieval gaps.

**Chunked for RAG:**
- Tenant policy markdown body (business context prose) is chunked and embedded like `concepts.md`
- Chunks for tenant-scoped tables carry metadata identifying their required scope roots
- Retrieved context enriches the prompt when relevant

**Parity guarantee:**
- The same fixture question must produce equivalent tenant guardrail outcomes with full-schema prompts and RAG-backed prompts
- Tenant metadata needed for validation is never lost during chunking/indexing/retrieval

### 8) Fixture and examples

Add a representative fixture with nested tenancy:

- `agencies` — top-level tenant root
- `sub_agencies` — child of agencies (hierarchy edge via `agency_id`)
- `clients` — child of sub_agencies (hierarchy edge via `sub_agency_id`)
- `orders` — direct scope via `agency_id` (P1)
- `campaigns` — direct scope via `owning_agency` (P2, varying column name)
- `appointments` — inherited scope via `client_id` → clients (P3)
- `notes` — polymorphic via `owner_type` + `owner_id` (P5)
- `lookup_states` — intentionally global/unscoped
- `service_types` — intentionally global/unscoped

The fixture should exercise:
- Agency-level access (direct IDs)
- Sub-agency access (direct IDs at child level)
- Subtree access (agency + all descendants)
- Multi-root access (specific agencies + specific clients across hierarchy)
- Inherited join scope (appointments through clients)
- Polymorphic scope (notes with type discriminator)
- Cross-tenant denial (query scoped tables without matching scope)
- Cross-tenant aggregation within scope (GROUP BY agency_id with scoped IDs)
- Explicit global/admin access
- Unknown table rejection/warning
- JOIN compatibility validation (scoped tables joined correctly vs. incorrectly)

## Scope (out)

- **Production policy engine** — this phase proves the contract and validator; deeper policy composition lands in the later production-depth phase.
- **Replacing host authorization** — AskDB does not become the source of truth for who a user is or which tenants they may access. The host passes the authorized scope.
- **Replacing database RLS** — applications should still use database row-level security or equivalent controls for production enforcement. AskDB's generated SQL guardrails are an additional safety layer, not the only one.
- **Full subtree CTE generation** — Phase 10 documents the subtree scope kind but the proof focuses on host-expanded IDs. Recursive CTE generation for subtree resolution may follow.
- **Composite tenant keys** — documented as a known pattern. The policy model does not block them, but Phase 10 does not validate composite-key queries.
- **All SQL shapes** — v0 may reject complex queries it cannot prove safe. This is by design (fail-closed).
- **All database engines** — this phase is Postgres-first; Phase 11 ports the proof deliberately per engine.
- **Raw row-data policy** — `bounded_results` summarization remains Phase 12 work.

## Spec decisions

| Topic | Decision |
|---|---|
| Phase placement | Phase 10, before additional database engines. |
| First engine | Postgres only for the proof. |
| Policy storage | `tenant-policy.md` in the Schema v2 directory — YAML front-matter for structure, markdown body for business context. Follows `concepts.md` pattern. |
| Policy source | Explicit tenant policy; no heuristic-only enforcement. AI-assisted drafting with per-section user confirmation. |
| Discriminator patterns | P1–P4 core, polymorphic (P5) modeled but host-resolved. |
| Scope resolution | Hybrid — AskDB stores hierarchy metadata; host chooses between pre-expanded IDs or subtree scope. Phase 10 proves flat IDs. |
| Runtime scope | Unified `TenantScope` input to `ask()` with enforced `access`, optional `tenantFilters`, and advisory `context`. |
| Context attributes | Known typed keys (`role`, `region`, `department`) + freeform `attributes` map. |
| SQL output | Named placeholders (`:tenant_<root>_ids`). Both SQL-only and SQL+params modes, configurable. |
| Prompt strategy | Policy front-matter always injected (security boundary). Body prose chunked for RAG. |
| Guardrail strategy | SQL parser + heuristic fallback. Cross-table JOIN scope compatibility verified. |
| Enforcement mode | Configurable per schema: `strict` (reject) or `warn` (flag). |
| Unknown tables | Explicitly tracked. New tables from re-introspection default to unknown with warning. |
| Aggregation | Allowed within user's scope. Global scope enables unrestricted aggregation. |
| Polymorphic | Policy models type/id columns + mapping to roots. Host resolves at runtime. Validator checks type discriminator presence. |
| Admin/global | Allowed only through an explicit runtime scope kind, never inferred from the natural-language question. |

## Success

After Phase 10:

1. An integrator can run AI-assisted tenant setup that drafts a `tenant-policy.md`, confirm each section (roots, hierarchy, scoped tables, polymorphic mappings, global tables, unknowns), and save it with the Schema v2 artifact.
2. A host can call `ask()` with a unified `TenantScope` carrying enforceable access and advisory user context.
3. Prompt assembly always includes the tenant policy front-matter and runtime scope; business context prose is available through RAG retrieval.
4. Generated SQL uses named placeholders for tenant predicates. Output is available as SQL-only (literals) or SQL+params (parameterized), configurable.
5. The SQL guardrail validator (parser + fallback) verifies every scoped table has the required predicate, JOINed tables have compatible scopes, and polymorphic tables include type discriminators.
6. Unsafe SQL is rejected (strict) or flagged (warn) when the model omits scope, when the host omits scope, when the requested question requires broader access than the user has, or when unknown tables are touched.
7. Tests prove direct tenant IDs (P1), varying column names (P2), inherited joins (P3), nested hierarchy subtrees (P4), polymorphic tables (P5), unscoped reference tables, cross-tenant aggregation within scope, JOIN compatibility, and explicit global/admin access.

## References

- [`docs/roadmap.md`](../../roadmap.md) — Phase 10
- [`docs/mission.md`](../../mission.md) — multi-tenant success criterion
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- [`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md) — tenant policy format contract
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 artifact this phase extends
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — source of physical schema and FK paths
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — terminal authoring surface
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — focused retrieval path
- [`docs/specs/phase-9-studio-revamp/`](../phase-9-studio-revamp/) — browser authoring surface
