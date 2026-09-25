# AskDB Tenant Policy — `tenant-policy.md` format contract

This document is the **format contract** for AskDB's tenant policy layer. It defines:

1. **File format** — YAML front-matter for machine-readable policy, markdown body for business context.
2. **Front-matter schema** — the structured fields and their meanings.
3. **Discriminator patterns** — the five tenant scoping patterns the policy can express.
4. **Runtime scope contract** — the `TenantScope` type passed to `ask()` at runtime.
5. **Enforcement modes** — how the guardrail validator uses the policy.
6. **Chunking rules** — how `@askdb/rag` handles tenant policy content.
7. **Relationship to Schema v2** — cross-references and co-evolution.

---

## File location

`tenant-policy.md` lives in the Schema v2 directory alongside `schema.json`:

```text
my-app.schema/
  schema.json                # physical layer
  tenant-policy.md           # ← tenant policy (this contract)
  tables/
    users.md
    orders.md
  concepts.md
  schema.lock.json
```

The file is optional. A Schema v2 directory without `tenant-policy.md` has no tenant enforcement — all queries are unrestricted and `ask()` does not require a `tenantScope` input.

When present, the file enables tenant enforcement: `ask()` requires a valid `tenantScope`, prompts include the policy, and generated SQL is validated against scope.

Only a **missing** file means "no tenant policy". In a bundle, that means only an absent `tenantPolicy` key. A `tenant-policy.md` that exists but is empty or cannot be read or parsed (for example, malformed YAML front-matter) makes `loadSchema()` throw `SchemaParseError` naming the file. The same applies to an empty or non-string bundle `tenantPolicy`. A broken policy never silently turns tenant enforcement off. `loadSchema("<dir>/schema.json")` loads the sibling `tenant-policy.md` the same way `loadSchema("<dir>")` does.

---

## Front-matter schema

The front-matter is YAML, validated by zod in `@askdb/core`. Cross-reference checks against `schema.json` are performed by the loader.

### Full example

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
  - id: table:public.clients
    tenantIdColumn: table:public.clients#id
    label: Client
    parent:
      root: table:public.sub_agencies
      foreignKey: table:public.clients#sub_agency_id

hierarchy:
  - parent: table:public.agencies
    child: table:public.sub_agencies
    foreignKey: table:public.sub_agencies#agency_id
  - parent: table:public.sub_agencies
    child: table:public.clients
    foreignKey: table:public.clients#sub_agency_id

scopedTables:
  - id: table:public.orders
    scopeThrough:
      - root: table:public.agencies
        column: table:public.orders#agency_id
  - id: table:public.campaigns
    scopeThrough:
      - root: table:public.agencies
        column: table:public.campaigns#owning_agency
  - id: table:public.appointments
    scopeThrough:
      - root: table:public.clients
        join:
          - from: table:public.appointments#client_id
            to: table:public.clients#id

polymorphicTables:
  - id: table:public.notes
    typeColumn: table:public.notes#owner_type
    idColumn: table:public.notes#owner_id
    mapping:
      agency: table:public.agencies
      sub_agency: table:public.sub_agencies
      client: table:public.clients

globalTables:
  - table:public.lookup_states
  - table:public.service_types
---
```

### Field reference

#### Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `schemaId` | string | yes | Must match the parent `schema.json`'s `schemaId`. |
| `enforcement` | `"strict"` \| `"warn"` | yes | Guardrail mode. `strict` rejects unproven queries; `warn` returns SQL with `tenantWarnings`. |
| `roots` | array | yes | Tenant root definitions (see below). At least one root required. |
| `hierarchy` | array | no | Explicit hierarchy edges between roots. Required when roots have parent/child relationships. |
| `scopedTables` | array | no | Tables whose rows are constrained by tenant roots. |
| `polymorphicTables` | array | no | Tables using type + id column pairs for tenant association. |
| `globalTables` | string[] | no | Stable table IDs for tables intentionally exempt from tenant filtering. |

#### `roots[]` — tenant root definitions

Each root is a table that represents a tenant entity in the hierarchy.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable table ID from `schema.json` (e.g., `table:public.agencies`). |
| `tenantIdColumn` | string | yes | Stable column ID of the root's primary identifier (e.g., `table:public.agencies#id`). |
| `label` | string | yes | Human-readable label used in prompt assembly and named placeholders (e.g., `Agency` → `:tenant_agency_ids`). |
| `parent` | object | no | If this root is a child in the hierarchy. |
| `parent.root` | string | yes (if parent) | Stable table ID of the parent root. |
| `parent.foreignKey` | string | yes (if parent) | Stable column ID of the FK linking this root to its parent. |

#### `hierarchy[]` — hierarchy edges

Explicit declaration of parent/child relationships between roots. Redundant with `roots[].parent` but provided for clarity and validation.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `parent` | string | yes | Stable table ID of the parent root. |
| `child` | string | yes | Stable table ID of the child root. |
| `foreignKey` | string | yes | Stable column ID of the FK on the child table pointing to the parent. |

**Validation:** hierarchy edges must form a DAG (directed acyclic graph). Cycles are a validation error.

#### `scopedTables[]` — tenant-scoped operational tables

Tables whose rows belong to a tenant scope. Each entry specifies how scope is applied.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable table ID from `schema.json`. |
| `scopeThrough` | array | yes | One or more scope paths. Each path connects this table to a tenant root. |
| `scopeThrough[].root` | string | yes | Stable table ID of the tenant root this path leads to. |
| `scopeThrough[].column` | string | conditional | Stable column ID of the direct tenant FK on this table. Use for P1 (single direct column) and P2 (varying column names). |
| `scopeThrough[].join` | array | conditional | FK join path from this table to the tenant root. Use for P3 (inherited via JOINs). Each step is `{ from, to }` with stable column IDs. |

Exactly one of `column` or `join` must be present per scope path.

**Multiple scope paths:** A table may have multiple `scopeThrough` entries if it can be scoped through different roots (e.g., an `invoices` table scoped both through `agency_id` directly and through `client_id` → `clients`). The validator accepts any path that satisfies the user's runtime scope.

#### `polymorphicTables[]` — polymorphic tenant association

Tables that use a type discriminator + id column pair, where the id references different tenant root tables depending on the type value.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable table ID from `schema.json`. |
| `typeColumn` | string | yes | Stable column ID of the type discriminator (e.g., `table:public.notes#owner_type`). |
| `idColumn` | string | yes | Stable column ID of the polymorphic FK (e.g., `table:public.notes#owner_id`). |
| `mapping` | Record<string, string> | yes | Maps type discriminator values to stable table IDs of tenant roots. Keys are the literal values stored in `typeColumn`. |

**Runtime:** Polymorphic tables are declared in the policy and surfaced to the model through the prompt. There is no runtime pre-resolution of polymorphic scope (an earlier `tenantFilters` scope field was never read and has been removed). The validator checks that generated SQL mentions the type discriminator and id columns.

#### `globalTables` — unscoped reference tables

An array of stable table IDs for tables that are intentionally exempt from tenant filtering. These are typically lookup/reference tables shared across all tenants (e.g., `lookup_states`, `service_types`).

Tables not listed in `scopedTables`, `polymorphicTables`, or `globalTables` are classified as **unknown**. Unknown tables trigger warnings and, in strict mode, block queries that reference them.

---

## Discriminator patterns

The policy expresses five discriminator patterns through its field structure:

| Pattern | Policy representation | Example |
|---|---|---|
| **P1: Single direct column** | `scopedTables[].scopeThrough[].column` — same FK name across tables | `orders.agency_id` |
| **P2: Varying column names** | `scopedTables[].scopeThrough[].column` — different FK names, same root | `campaigns.owning_agency` → `agencies` |
| **P3: Inherited via JOINs** | `scopedTables[].scopeThrough[].join` — FK chain to reach the root | `appointments` → `clients` → `sub_agencies` |
| **P4: Multi-level hierarchy** | `roots[].parent` + `hierarchy[]` — hierarchy edges between roots | `agencies` → `sub_agencies` → `clients` |
| **P5: Polymorphic association** | `polymorphicTables[]` — type + id columns with root mapping | `notes.owner_type` + `notes.owner_id` |

---

## Markdown body

The markdown body follows the `# Tenant Policy` heading and provides human-readable business context. Recognized H2 sections:

| H2 | Purpose | Used by |
|---|---|---|
| `Hierarchy` | Describes the organizational hierarchy in business terms. | Prompt assembly, RAG chunks. |
| `Scope rules` | Describes how data ownership flows through the schema. | Prompt assembly, RAG chunks. |
| `Sensitive interactions` | Documents where tenant scoping intersects with sensitive-field rules. | Prompt assembly, RAG chunks. |

Other H2 sections are stored as freeform body text.

### Example body

```markdown
# Tenant Policy

This database serves a multi-level agency management platform.

## Hierarchy

Agencies are the top-level tenants. Each agency can have multiple
sub-agencies, and each sub-agency manages multiple clients. Data
flows downward — an agency admin can see all sub-agency and client
data beneath them.

## Scope rules

Most operational tables (orders, appointments, campaigns) carry a
direct agency_id or are scoped through a client/sub-agency
relationship. The notes table uses polymorphic ownership — a note
can belong to an agency, sub-agency, or client depending on the
owner_type discriminator.

## Sensitive interactions

The clients table contains PII columns marked sensitive in the
schema. Tenant scoping and sensitive-field rules apply independently
— a user scoped to agency 42 still cannot see sensitive client fields
unless the operating mode permits it.
```

---

## Runtime scope contract — `TenantScope`

The host passes a `TenantScope` object to `ask()` when a tenant policy exists. This is a unified object carrying both **enforceable access** and **advisory context**.

### TypeScript shape

```ts
interface TenantScope {
  access:
    | {
        kind: "ids";
        tenantRoot: string;
        ids: string[];
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
        reason: string;
      };

  context?: {
    role?: string;
    label?: string;
    department?: string;
    region?: string;
    attributes?: Record<string, string>;
    description?: string;
  };
}
```

`TenantScope` previously declared a `tenantFilters` field for host-resolved polymorphic scope. Nothing ever read it, so it has been removed; a stray `tenantFilters` key on a scope object is ignored by validation.

### Access kinds

| Kind | Meaning | When to use |
|---|---|---|
| `ids` | User can see rows matching specific tenant IDs at one root level. | Most common. Host has resolved the user's access to a flat ID list. |
| `subtree` | User can see a root and all its descendants in the hierarchy. | **Not supported yet — rejected.** Descendant expansion is not implemented, so `validateTenantScope()`, `buildTenantPromptBlock()`, and `ask()` throw `TenantScopeError` (`UNSUPPORTED_ACCESS_KIND`) instead of silently scoping to `rootIds` only. Resolve the subtree in the host and pass explicit IDs with `ids` (or `multi_root`). |
| `multi_root` | User has different scopes at different hierarchy levels. | Edge case: user is admin at one agency but also has direct client-level access elsewhere. |
| `global` | User can see all data across all tenants. | Admin/superuser. Requires an explicit `reason` string for audit. |

### Advisory context

| Field | Type | Purpose |
|---|---|---|
| `role` | string | User's role (e.g., `regional_manager`, `frontline_worker`). Logged for audit. |
| `label` | string | Display name (e.g., `Jane Smith, Northeast Agency`). Prompt context only. |
| `department` | string | Organizational department (e.g., `sales`, `operations`). |
| `region` | string | Geographic or organizational region (e.g., `northeast`). |
| `attributes` | Record<string, string> | Freeform key-value pairs for additional context. |
| `description` | string | Prose description of the user's role/scope in business terms. |

Advisory context is included in prompts to help the LLM generate more relevant queries. It is **not enforced** by the guardrail validator.

### Enforcement rules

| Condition | Behavior |
|---|---|
| Tenant policy exists, no `tenantScope` passed | Fail closed. Query rejected before prompt generation. |
| `tenantScope.access` references unknown tenant root | Rejected. |
| `global` scope without `reason` | Rejected. |
| `subtree` scope | Rejected (`UNSUPPORTED_ACCESS_KIND`) — not implemented yet. |
| Generated SQL references a `:tenant_*` placeholder the scope has no IDs for (or that matches no root) | Rejected (`UNRESOLVED_TENANT_PLACEHOLDER`). SQL with an unsubstituted placeholder is never returned. |
| Several IDs meet a tenant predicate with no list form (`<`, `>`, `<=`, `>=`, or a non-comparison position) | Rejected (`UNSUPPORTED_TENANT_PREDICATE`). |
| Advisory `context` with unknown keys in `attributes` | Accepted (freeform). |

---

## SQL output

### Named placeholder convention

The prompt instructs the LLM to generate SQL using named placeholders for tenant predicates:

```
:tenant_<root_label_lowercase>_ids
```

Examples:
- `:tenant_agency_ids` for the `Agency` root
- `:tenant_sub_agency_ids` for the `Sub-Agency` root
- `:tenant_client_ids` for the `Client` root

### Output modes

| Mode | Output shape | Placeholder handling |
|---|---|---|
| **SQL-only** (default) | `sql` | Named placeholders replaced with escaped literal values. SQL is complete and executable. |
| **SQL+params** | `sql` + `tenantParams` | Named placeholders replaced with the dialect's driver markers — `$1, $2` (Postgres, CockroachDB, and custom `AskDialect`s), `?` (MySQL, MariaDB, SQLite), `@p0, @p1` (SQL Server). `tenantParams` holds the IDs in marker order. |

The mode is configurable per `ask()` call (`tenantSqlMode`).

**Substitution rules.** Only placeholders in SQL code are substituted — placeholder text inside string literals or quoted identifiers is left untouched, so a tenant ID can never land inside (or close) a surrounding literal. With several IDs, `= :p` becomes `IN (…)`, `!= :p` / `<> :p` become `NOT IN (…)`, `IN (:p)` / `NOT IN (:p)` are expanded in place, and `= ANY(:p)` / `<> ALL(:p)` become `IN (…)` / `NOT IN (…)`. Any other operator or position with several IDs is rejected rather than rewritten.

**Executable pairs.** Each SQL form `ask()` returns runs with exactly one params array — never concatenate them:

| SQL | Run with | Contents |
| --- | --- | --- |
| `result.sql` | `result.tenantParams` (`sql-params` mode; nothing in `sql-only`) | Business values inlined as literals; tenant markers numbered from the first slot. |
| `result.unboundSql` | `result.params` | All values as markers. In `sql-params` mode `params` already includes the tenant IDs: after the business values for numbered markers (`$N`, `@pN`), interleaved in source order for `?` dialects. `parameters[].indices` point into this array. In `sql-only` mode tenant IDs are inlined literals in `unboundSql` and `params` holds business values only. |

`tenantBindings` keeps its tenant-only meaning for audit. `bindPreparedQuery()` binds tenant placeholders by name mechanically and **does not authorize** the IDs you pass; authorization remains the host's responsibility when constructing `tenantScope`.

---

## Guardrail validation

In `ask()`, the validator runs on the SQL returned to the caller: `result.sql` after tenant placeholder replacement, plus `result.unboundSql` when the parameterized extras pass their consistency check. It runs for every dialect form, including custom `AskDialect` adapters. `generateSelectSql()` called directly validates the SQL it returns (placeholders still named).

### Parser-based validation (primary)

Uses `node-sql-parser` (or equivalent) to parse the SQL into an AST:

1. Identify all referenced tables and their aliases.
2. For each tenant-scoped table: verify the required tenant predicate (`column = :placeholder` or `column = ANY(:placeholder)`) or validated inherited join path exists.
3. For each polymorphic table: verify the type discriminator column appears in the WHERE clause.
4. For JOINs between tenant-scoped tables: verify scope compatibility (both tables scoped to the same tenant root/IDs).
5. For aggregation across tenant boundaries: verify the user's scope covers the aggregated set, or reject if `global` scope is required.
6. For unknown tables: reject (strict) or flag (warn).

### Heuristic fallback

When the parser cannot handle a SQL shape:

1. Apply conservative pattern matching (table name detection, predicate presence).
2. If heuristics cannot prove scope safety: reject (strict) or flag with `tenantWarnings` (warn).

Pattern matching runs only over SQL code: string literals (`'…'`, `$tag$…$tag$`) and comments (`--`, `/* */`) are ignored, so a tenant column or table name that appears only inside them does not count. Quoted identifiers (`"agency_id"`, `` `orders` ``, `[orders]`) still count as the identifier they name.

### Enforcement modes

| Mode | Unproven query | Unknown table | Missing scope predicate |
|---|---|---|---|
| `strict` | Rejected with policy error. | Rejected. | Rejected. |
| `warn` | Returned with `tenantWarnings`. | Returned with warning. | Returned with warning. |

Policy errors include: the table ID(s) involved, the expected scope path, and what was missing.

---

## Chunking rules

`@askdb/rag` handles `tenant-policy.md` with a dual strategy:

### Always injected (not chunked)

The front-matter (structural policy data) is always included in every prompt when a tenant policy exists. This is a security boundary and must never be lost through RAG retrieval gaps.

### Chunked for RAG retrieval

The markdown body (business context prose) is chunked following the `concepts.md` pattern:

| Chunk type | ID | Content |
|---|---|---|
| **Hierarchy** | `chunk:tenant-policy#hierarchy` | The `## Hierarchy` body, prefixed with schema ID. |
| **Scope rules** | `chunk:tenant-policy#scope-rules` | The `## Scope rules` body, prefixed with schema ID. |
| **Sensitive interactions** | `chunk:tenant-policy#sensitive` | The `## Sensitive interactions` body, prefixed with schema ID. |
| **Other sections** | `chunk:tenant-policy#section:<slug>` | Other H2 bodies, prefixed with schema ID. |

Long sections use `#bc:<n>` suffixes following the existing chunking convention.

### Tenant metadata on table chunks

Chunks for tenant-scoped tables carry metadata identifying their required scope root(s). This ensures that when a table chunk is retrieved, the prompt assembler can include the relevant tenant context even in a focused RAG prompt.

---

## Schema evolution

| Scenario | Behavior |
|---|---|
| New table added via re-introspection | Classified as **unknown** in the coverage report. Warning triggered. Strict mode blocks queries touching it until classified. |
| Table removed | Orphaned references in `tenant-policy.md` flagged as warnings. Authoring surfaces offer a prune flow. |
| FK path changed | Propagation paths referencing the old FK produce validation errors. Integrator must update the policy. |
| Column renamed | Column IDs in `scopeThrough`, `polymorphicTables`, etc. become orphaned. Reported as validation errors. |
| New `tenant-policy.md` added to existing schema | Tenant enforcement activates. All `ask()` calls now require `tenantScope`. |
| `tenant-policy.md` removed | Tenant enforcement deactivates. `ask()` no longer requires `tenantScope`. |

---

## Relationship to Schema v2

`tenant-policy.md` extends the Schema v2 artifact without modifying the physical layer:

- All IDs in the policy reference stable IDs from `schema.json` (table IDs and column IDs).
- The loader validates cross-references at load time.
- The policy is optional — Schema v2 directories without it behave identically to pre-Phase-10.
- The policy is authored alongside `tables/*.md` and `concepts.md` in Studio.
- The bundler (`askdb bundle`) includes `tenant-policy.md` content in the bundled JSON.
- Re-introspection does not modify `tenant-policy.md` — it only updates `schema.json`. The loader reports any resulting cross-reference mismatches.

---

## Implementation locus

| Concern | Package |
|---|---|
| Front-matter parser, validator, normalizer | `@askdb/core` |
| `TenantScope` type and runtime validation | `@askdb/core` |
| Prompt assembly (policy injection, scope formatting) | `@askdb/core` |
| SQL guardrail validator (parser + heuristic) | `@askdb/core` |
| SQL output modes (SQL-only, SQL+params) | `@askdb/core` |
| AI-assisted policy drafting | `@askdb/enrich` |
| Setup capture UI (per-section confirmation) | `@askdb/studio` |
| Body chunking, scope root metadata on table chunks | `@askdb/rag` |
| Fixture | `fixtures/schemas/` |
| CLI surface (`--tenant-scope`) | `apps/cli/` |
| HTTP API surface | `apps/http-api/` |

---

## References

- [`docs/contracts/schema-v2.md`](./schema-v2.md) — Schema v2 format contract
- [`docs/contracts/sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) — sensitive identifier rules
- [`docs/specs/multi-tenancy.md`](../specs/multi-tenancy.md) — multi-tenancy feature spec
