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
| `label` | string | yes | Human-readable label used in prompt assembly and named placeholders (e.g., `Agency` → `:tenant_agency_ids`). Each root must derive a distinct placeholder. The name keeps only ASCII letters and digits (other runs become `_`); a label with none of them (e.g. Cyrillic or CJK) uses the root's table name instead (see [Named placeholder convention](#named-placeholder-convention)). Two roots that derive the same placeholder (`Agency` and `agency`, `Sub-Agency` and `Sub Agency`) are a load error (`SchemaParseError`), because one root's IDs would be bound where the other root's column is compared. |
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
          ids: string[]; // may be empty: the root is covered but has no IDs
        }>; // at least one entry must have an ID
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
| `subtree` | User can see a root and all its descendants in the hierarchy: same-table descendants of the root, and the rows of every descendant root (`roots[].parent`, `hierarchy[]`). | Hierarchical admins (state → counties, agency → sub-agencies → clients). Requires `ask({ resolveTenantDescendants })`, which returns IDs per root; see [Subtree expansion](#subtree-expansion). |
| `multi_root` | User has different scopes at different hierarchy levels. An entry may have an empty `ids` list: that root is covered but has no IDs, so reading it fails closed (its placeholder throws `UNRESOLVED_TENANT_PLACEHOLDER`). At least one entry must have an ID. | Edge case: user is admin at one agency but also has direct client-level access elsewhere. |
| `global` | User can see all data across all tenants. | Admin/superuser. Requires an explicit `reason` string for audit. |

### Subtree expansion

AskDB does not open database connections, so it cannot compute a subtree itself. The host supplies the expansion to `ask()`:

```ts
type TenantIdsByRoot = Readonly<Record<string, readonly string[]>>;

type ResolveTenantDescendants = (
  tenantRoot: string,
  seedIds: readonly string[],
) => Promise<TenantIdsByRoot> | TenantIdsByRoot;

ask({ ..., tenantScope, resolveTenantDescendants });
```

Each root table has its own ID space: in the P4 fixture, client `5` and agency `5` are different tenants. So the resolver returns the subtree's IDs **per tenant root**, keyed by root table ID, and each root's IDs bind only to that root's own `:tenant_<label>_ids` placeholder (see [ADR 0014](../adrs/0014-subtree-scope-expands-per-root.md)). For an agency admin over `agencies` → `sub_agencies` → `clients`, where agency `1` owns sub-agency `5` and client `5`:

```ts
resolveTenantDescendants("table:public.agencies", ["1"]);
// → {
//     "table:public.agencies": ["1"],
//     "table:public.sub_agencies": ["5"],
//     "table:public.clients": ["5"],
//   }
```

Contract:

- `ask()` calls the resolver once, after scope validation and before model generation, with `access.tenantRoot` and `access.rootIds`.
- The allowed keys are `tenantRoot` and every root reachable from it through `roots[].parent` or `hierarchy[]`. The value under a key holds IDs of that root's own `tenantIdColumn`, never another root's IDs.
- Under `tenantRoot`, return the seeds and any same-table descendants. A self-referencing hierarchy (e.g. `agencies.parent_agency_id`, which the policy can't declare yet) puts every agency in the tree under `tenantRoot`.
- `ask()` unions the seed IDs into the `tenantRoot` entry (deduplicated), so an ancestor never loses its own rows when a resolver returns strict descendants only. A missing key, or an empty array, means that root has no IDs in the subtree.
- The expanded scope is `{ kind: "multi_root", scopes }`, with one entry per root the subtree covers: `tenantRoot` first, then its descendant roots breadth-first. A covered root with no IDs stays in the scope with `ids: []`, so reading it fails closed (below) instead of being less restricted than a root with some IDs. When the subtree is `tenantRoot` alone (no descendant roots in the policy), it is the equivalent `{ kind: "ids", tenantRoot, ids }`. The prompt, the tenant guardrail, and placeholder substitution all see the expanded scope, and so does a custom `AskDialect` (`options.tenantScope`). The scope schema allows an empty `ids` list per `multi_root` entry (at least one entry must have an ID), so `validateTenantScope()` accepts the expanded scope. Advisory `context` is unchanged.
- When the policy declares more than one root, the prompt for a `multi_root` or `ids` scope lists, under each placeholder, the columns that hold that root's IDs (its own ID column, child roots' foreign keys to it, scoped tables' direct columns, and polymorphic ID columns with their discriminator value), and tells the model never to compare one root's placeholder with another root's column. For `multi_root`, a child root's foreign key is left out of its parent's list when that child is itself in the scope; a root with no IDs is marked as such; and the prompt says that every listed root table the query reads must be filtered with its own placeholder, not only through its parent's foreign key or a joined ancestor. A single-root policy's `ids` block is unchanged.
- The expanded scope goes through the same [guardrail validation](#guardrail-validation) as any `multi_root` scope. So each scoped table's tenant column must be compared with its own root's placeholder, and a polymorphic discriminator must match the root whose placeholder filters the id column. Each root the expanded scope names (every covered level, including one with no IDs) is checked as a root table. A query that reads `clients` under an expanded agency subtree must filter it with `:tenant_client_ids` (or a column that carries client IDs), not only through `clients.sub_agency_id` or a joined, filtered agency. The guardrail's remaining limits (below) still apply.
- A covered root with no IDs therefore can't be read. The guardrail requires its own placeholder, and binding that placeholder throws `UNRESOLVED_TENANT_PLACEHOLDER`. Its placeholder is never bound to another root's IDs.
- **Fail closed.** These throw `TenantScopeError` with reason `SUBTREE_NOT_RESOLVABLE` before model generation: no resolver; a result that is an array (the flat shape from before this contract) or not a plain object; a key that isn't a tenant root in the policy, or a root outside this subtree; a value that isn't an array of non-empty strings; or no IDs at all. AskDB never falls back to the seed IDs alone, and never folds IDs from one root into another root's placeholder.
- The host owns authorization and caching of the closure. AskDB trusts the returned IDs.

`resolveTenantSql()` and `buildTenantPromptBlock()` (exported) do not walk the hierarchy. A direct caller must pass an already-expanded `multi_root` access with each root's IDs under that root (or an `ids` access when the subtree is one root table); an unexpanded `subtree` throws `TenantScopeError` (`SUBTREE_NOT_RESOLVABLE`) rather than substitute the seed IDs only.

`@askdb/core` also exports `expandClosure(seedIds, childrenOf)`, a breadth-first, cycle-safe walk over an in-memory hierarchy of one root, for use inside a resolver.

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
| `subtree` scope with no `resolveTenantDescendants`, or a resolver returning a flat array, a key outside the subtree's roots, an invalid ID list, or no IDs | Rejected before prompt generation (`SUBTREE_NOT_RESOLVABLE`). |
| Unexpanded `subtree` scope passed directly to `resolveTenantSql()` or `buildTenantPromptBlock()` | Rejected (`SUBTREE_NOT_RESOLVABLE`). |
| Two roots that derive the same `:tenant_<name>_ids` placeholder | Rejected with `SchemaParseError` naming both roots: when the policy loads, by `validateTenantScope()` (so by `ask()`) and by `resolveTenantSql()` for a policy built in code or changed after validation, and by Studio's policy save (400, nothing written). |
| Generated SQL references a `:tenant_*` placeholder the scope has no IDs for (or that matches no root) | Rejected (`UNRESOLVED_TENANT_PLACEHOLDER`). SQL with an unsubstituted placeholder is never returned. |
| Several IDs meet a tenant predicate with no list form (`<`, `>`, `<=`, `>=`, or a non-comparison position) | Rejected (`UNSUPPORTED_TENANT_PREDICATE`). |
| `"sql-only"` substitution of a tenant ID containing a backslash, with a dialect whose `backslashEscapes` is unset and whose `id` is not built-in | Rejected (`UNESCAPABLE_TENANT_ID`). A built-in `id` with `backslashEscapes` unset uses that engine's escaping (backslash escapes on for MySQL and MariaDB). |
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

The name is the label lowercased, with every run of characters other than ASCII letters and digits replaced by `_`. A label with no ASCII letter or digit (Cyrillic, CJK, …) would reduce to `_` for every such root, so its placeholder comes from the root's table name instead: `Клиент` on `table:public.clients` → `:tenant_clients_ids`. Labels with an ASCII letter or digit always use the label. The prompt, placeholder substitution, the tenant guardrail and the load-time collision check all use this one derivation, exported as `placeholderForTenantRoot(root)`. The older `placeholderForRoot(label)` is deprecated: it takes the label alone, so for a label with no ASCII letter or digit it still returns `:tenant___ids`, which core no longer binds. Two roots that still derive the same placeholder are rejected (see the `label` row and Enforcement rules).

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

The check runs on the model's SQL **before** tenant rendering: the bound statement and, when present, its `sql-unbound` block, with the `:tenant_<root>_ids` placeholders still in place. Tenant rendering (`resolveTenantSql()`) then only swaps each placeholder for literals (`sql-only`) or the dialect's driver markers (`sql-params`), so one check covers every `tenantSqlMode`, dialect and output form. `ask()` checks those forms for every dialect path, including custom `AskDialect` adapters, and `generateSelectSql()` checks the SQL it returns, whose placeholders are still named. A direct `validateTenantGuardrails()` call should likewise get the SQL with its placeholders.

### What the check requires

The check is a heuristic over SQL tokens, not a SQL parser:

1. **Scoped tables.** For each tenant-scoped table the query mentions, it looks for a tenant predicate on one of its scope paths.
   - For a `column` path, the predicate is the table's tenant column compared with its root's placeholder: `col = :tenant_<root>_ids`, `col IN (:tenant_<root>_ids)` or `col = ANY(:tenant_<root>_ids)`, on either side, and optionally qualified (`o.agency_id`).
   - For a `join` path, every join column must appear, plus a tenant predicate on a column that carries the IDs of the path's root or of one of its ancestors in the hierarchy (`hierarchy[]`, `roots[].parent`): that root's `tenantIdColumn`, or a child root's foreign key to it, such as `sub_agencies.agency_id = :tenant_agency_ids`. A root outside that chain doesn't count, even one the scope binds: under a vendor scope, `CROSS JOIN vendors v WHERE v.id = :tenant_vendor_ids` doesn't filter `appointments`, whose path runs through `clients`. A predicate qualified with another table's name or alias doesn't count: `a.id = :tenant_agency_ids`, where `a` is `appointments`, filters nothing.
2. **Conjuncts only.** The predicate counts only as a conjunct of a `WHERE` clause, an inner join's `ON` clause, or a `HAVING` clause: ANDed with the rest of the clause, at its own level and at every enclosing parenthesized level. It doesn't count next to an `OR` or `XOR` at any of those levels (or MySQL's `||`), under `NOT`, compared again (`(… = :p) = FALSE`), inside a function call or `CASE`, or in the select list. An `OR` inside its own parentheses is fine: `agency_id = :tenant_agency_ids AND (status = 'a' OR status = 'b')`. An outer join's `ON` (`LEFT`, `RIGHT`, `FULL`, with or without a SQL Server join hint such as `LEFT HASH JOIN`) doesn't count, because it doesn't filter the preserved side, and neither does a filter inside `OUTER APPLY`. A quoted identifier (`"where"`) is never read as a keyword. A predicate inside a subquery counts when the subquery is a row source (a derived table or CTE), or when the whole `col IN (subquery)` is itself such a conjunct; not inside `EXISTS (…)` or a scalar subquery. A parenthesized statement, or a parenthesized operand of a set operation (`(SELECT …) UNION ALL (SELECT …)`), is used the way the query around it is, so at the top level or in a derived table its predicate counts.
3. **No literals or bare mentions.** A literal tenant ID (`agency_id = 2`) never satisfies the rule, even one inside the caller's scope: AskDB binds the IDs itself. Each `UNION`, `INTERSECT` or `EXCEPT` branch that mentions a scoped table needs its own predicate, at the top level or inside a derived table or CTE, so one branch's predicate can't cover another branch's literal. A bare mention of the column, as in `SELECT agency_id FROM …`, doesn't count either.
4. **Root tables.** A root table the scope covers, such as `agencies` under an agency scope, needs the same predicate on its `tenantIdColumn`.
5. **Polymorphic tables.** They need a tenant predicate on the id column with the placeholder of a root in `mapping`, and, in the same query block, a discriminator conjunct that picks that root: `typeColumn = '<key>'`, where `mapping[<key>]` is the root whose placeholder the id predicate uses. So `owner_type = 'agency' AND owner_id = :tenant_agency_ids` passes, while `owner_id = :tenant_agency_ids` alone, or with `owner_type = 'client'`, is rejected as `MISSING_TYPE_DISCRIMINATOR`. The discriminator is read as a plain `'…'` literal compared with `=`, ANDed like the id predicate; an `IN` list or any other form doesn't count.
6. **Unknown tables.** Rejected (strict) or flagged (warn), as `UNKNOWN_TABLE_REFERENCED`.

A failed check throws `TenantGuardrailError` in `strict` mode, and is returned in `result.tenantGuardrail` in `warn` mode. The rule code is `MISSING_TENANT_PREDICATE`, `MISSING_TYPE_DISCRIMINATOR` or `UNKNOWN_TABLE_REFERENCED`.

**Limits.** Within one query block, the check doesn't tie a predicate to a particular table reference or alias, so an unfiltered or mispaired reference next to a filtered one can still pass (for example a scalar subquery on `clients` compared with `:tenant_agency_ids` beside a correctly filtered read of `clients`; see also #399, where a predicate in a CTE or derived table satisfies the check for an outer read), and so can a literal beside a real predicate on another reference. Only the roots the scope names are checked as root tables; a root reached through the hierarchy (`sub_agencies` under an agency `ids` scope) is not. An expanded `subtree` scope names every level it covers, including one with no IDs, so under it those roots are checked. Nor does it check that joined scoped tables share a scope. Treat it as defense in depth: the sound boundaries are database-side row-level security and the read-only role the host runs the SQL as. A deterministic rewrite that attaches the predicate itself is planned in #235.

Pattern matching runs only over SQL code: string literals (`'…'`, `$tag$…$tag$`) and comments (`--`, `/* */`) are ignored, so a tenant column or table name that appears only inside them does not count. Quoted identifiers (`"agency_id"`, `` `orders` ``, `[orders]`) still count as the identifier they name.

Regions are read the way the target dialect reads them. On MySQL and MariaDB, `"…"` is a string literal, not an identifier, `#` starts a comment, `--` starts one only when whitespace or a control character follows it (so in `:tenant_agency_ids--1 OR 1=1` the `OR` is code), the body of a `/*! … */` executable comment is read both as code and as a comment (the server runs it only if it is new enough, so an `OR` in it counts and a predicate in it doesn't), and a backslash escapes the next character inside strings (when the dialect's `backslashEscapes` is set), so `'it\'s agency_id'` is one string. On Postgres and CockroachDB, a backslash escapes the next character inside an `E'…'` escape string, so `E'it\'s agency_id'` is one string too. `ask()` passes the dialect whenever it has a `DialectSpec`. For a custom `AskDialect`, or a direct `validateTenantGuardrails()` call without `options.dialect`, the statement must pass under the standard-SQL, the Postgres, and the MySQL reading: a table counts as referenced if any reading sees it, and a tenant predicate counts only if every reading does. So a predicate written only as `"agency_id"` is flagged there.

A tenant placeholder counts only in its exact lowercase form (`:tenant_agency_ids`). Any other casing (`:TENANT_AGENCY_IDS`) is never substituted: `resolveTenantSql()` and `ask()` reject it with `UNRESOLVED_TENANT_PLACEHOLDER`.

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
