# Plan — Phase 10 (multi-tenant proof) (demoable milestones)

Numbered groups are **ordered** so each milestone is demoable. The proof starts with a policy contract and fixture because tenant safety is a cross-cutting behavior: schema metadata, prompt assembly, RAG, and SQL validation all need the same vocabulary.

## 1 — Tenant policy contract and format

- Define the `tenant-policy.md` format contract (see [`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md)):
  - YAML front-matter: roots, hierarchy edges, scoped tables, polymorphic tables, global tables, enforcement mode
  - Markdown body: business context prose (hierarchy description, scope rules, sensitive interactions)
- Add TypeScript types in the package that owns Schema v2 loading:
  - `TenantRoot`, `HierarchyEdge`, `ScopedTable`, `PolymorphicTable`, `TenantPolicy`
  - `TenantScope` (unified runtime input: `access` + `tenantFilters` + `context`)
  - `TenantFilter` for polymorphic overrides
  - Known context keys: `role`, `region`, `department`, `label`, `description`, `attributes`
- Add zod schemas for front-matter validation
- Add cross-reference validation: policy IDs must reference valid `schema.json` table/column IDs
- Add enforcement mode type: `strict` | `warn`

**Demo:** Load a schema artifact with `tenant-policy.md` and print a normalized policy summary showing roots, hierarchy, scoped tables (with pattern type), polymorphic mappings, global tables, and unknowns.

## 2 — Multi-tenant fixture

- Add a fixture schema with:
  - `agencies` — top-level tenant root
  - `sub_agencies` — child of agencies (hierarchy edge via `agency_id`)
  - `clients` — child of sub_agencies (hierarchy edge via `sub_agency_id`)
  - `orders` — direct scope via `agency_id` (P1: single direct column)
  - `campaigns` — direct scope via `owning_agency` (P2: varying column name)
  - `appointments` — inherited scope via `client_id` → clients (P3: inherited via JOINs)
  - `notes` — polymorphic via `owner_type` + `owner_id` (P5: polymorphic association)
  - `lookup_states` — intentionally global/unscoped
  - `service_types` — intentionally global/unscoped
- Include a `tenant-policy.md` with:
  - Front-matter covering all five discriminator patterns
  - Markdown body describing the agency/sub-agency/client hierarchy in business terms
- Add expected policy normalization snapshots
- Add a table coverage report snapshot (every table classified)

**Demo:** A test loads the fixture and reports which tables are scoped (with pattern), inherited, polymorphic, global, or unknown.

## 3 — Setup-time capture in authoring surfaces (AI-assisted)

- Add shared enrichment helpers for tenant policy draft/load/save
- Add AI-assisted drafting:
  - Analyze FK relationships, column patterns, self-referential tables, polymorphic patterns after introspection
  - Generate a draft `tenant-policy.md` from the analysis
- Add a focused TUI or Studio flow with per-section explicit confirmation:
  - Is this schema multi-tenant?
  - Confirm tenant root tables and hierarchy edges
  - Confirm direct-scope tables and their tenant columns (P1, P2)
  - Confirm inherited-scope tables and their JOIN paths (P3)
  - Confirm hierarchy traversal paths (P4)
  - Confirm polymorphic table mappings (P5)
  - Confirm global/unscoped tables
  - Review coverage report: scoped / inherited / polymorphic / global / unknown
  - Choose enforcement mode (strict / warn)
- Require explicit confirmation before tenant enforcement is enabled
- Unknown tables are explicitly tracked and visible in the coverage report

**Demo:** Open the fixture in Studio or TUI, see the AI-drafted policy, confirm each section, save, reload, and see the same coverage report.

## 4 — Runtime `TenantScope` input

- Add the unified `TenantScope` option to `ask()` with:
  - `access`: enforced scope (ids, subtree, multi_root, global)
  - `tenantFilters`: optional polymorphic table overrides (host-resolved)
  - `context`: advisory user context (role, region, department, label, description, attributes)
- Validate scope shape before prompt generation:
  - Tenant policy exists but no runtime scope supplied → fail closed
  - Runtime scope references an unknown tenant root → reject
  - `global` scope without explicit reason → reject
  - `subtree` scope kind is accepted but Phase 10 requires host-expanded IDs in practice
- Validate `tenantFilters` reference valid polymorphic tables in the policy
- Advisory `context` is passed through to prompt assembly without validation

**Demo:** Calling `ask()` against the fixture without scope fails before model generation; calling it with a valid agency scope (including advisory context) proceeds to prompt assembly.

## 5 — Prompt assembly boundary

- Add tenant policy section to full-schema prompt assembly:
  - Policy front-matter (always injected): roots, hierarchy, scoped tables, polymorphic mappings, global tables
  - Runtime scope (always injected): user's access kind and constraints
  - Advisory context (always injected when present): role, region, department, description
- Include strict instructions:
  - Every tenant-scoped table must be constrained to the current user's scope
  - Use named placeholders: `:tenant_<root_label>_ids`
  - Polymorphic tables must include type discriminator in WHERE
  - Global tables do not need tenant predicates
  - Unknown tables should not be referenced (strict) or trigger a warning (warn)
- Add golden prompt tests for:
  - No tenant policy (byte-identical to pre-Phase-10)
  - Policy + exact tenant IDs (ids kind)
  - Policy + subtree scope
  - Policy + multi_root scope
  - Policy + global scope
  - Policy + advisory context (role, region)
  - Policy + polymorphic tables

**Demo:** Snapshot the prompt for "show revenue by client this quarter" and verify the tenant policy block, scope, and user context are present.

## 6 — SQL guardrail validator

- Add `node-sql-parser` (or equivalent) as a dependency for Postgres SQL parsing
- Implement conservative Postgres SQL checks for generated `SELECT` statements:
  - Parse SQL into AST; identify referenced tables and aliases
  - For each tenant-scoped table, verify the required tenant predicate or validated inherited join path exists
  - For polymorphic tables, verify the type discriminator column appears in WHERE
  - Verify cross-table scope compatibility on JOINs (prevent mismatched scopes)
  - Allow aggregation within user's scope; require global scope for unrestricted aggregation
- Implement heuristic fallback for SQL the parser cannot handle:
  - Conservative pattern matching as a safety net
  - Reject if neither parser nor heuristics can prove scope safety (strict mode)
- Implement enforcement modes:
  - `strict`: reject unproven queries with clear policy error (table IDs, missing scope paths)
  - `warn`: return SQL with `tenantWarnings` array; host decides
- Handle unknown tables: reject (strict) or warn (warn)

**Demo:** Feed validator fixtures with safe and unsafe SQL. Missing `agency_id`/scope joins fail closed; mismatched JOIN scopes fail; polymorphic without type discriminator fails; correctly scoped SQL passes; unknown tables flagged.

## 7 — SQL output modes

- Implement named placeholder convention: `:tenant_<root_label>_ids`
- Implement SQL-only mode (default):
  - Replace named placeholders with literal values
  - Return complete, executable SQL string
- Implement SQL+params mode:
  - Convert named placeholders to positional parameters (`$1`, `$2`)
  - Return `{ sql, params, tenantBindings }` with bound values
- Make the mode configurable per `ask()` call or per schema config
- Ensure the validator works with both modes (validates before placeholder replacement)

**Demo:** Same question returns executable SQL (literals) in SQL-only mode and `{ sql, params }` in parameterized mode. Both pass the guardrail validator.

## 8 — RAG propagation

- Ensure tenant policy front-matter is always injected into prompts regardless of RAG retrieval (security boundary)
- Chunk tenant policy markdown body for RAG:
  - Create chunks following `concepts.md` pattern
  - Include hierarchy description, scope rules, sensitive interactions as retrievable context
- Attach required scope root metadata to chunks for tenant-scoped tables
- Update synthesized DDL prompt assembly so focused prompts include:
  - Full tenant policy front-matter (always)
  - Retrieved tenant policy body chunks (when relevant)
  - Tenant context for every retrieved scoped table
- Add tests showing RAG-backed prompts enforce the same tenant guardrails as full-schema prompts

**Demo:** Ask the fixture with a retriever enabled; the focused prompt still includes the full tenant policy front-matter; body chunks are retrieved when relevant; generated SQL is validated against scope.

## 9 — CLI/HTTP/Studio integration surfaces

- Add CLI support for tenant scope: JSON file flag (`--tenant-scope scope.json`)
- Add HTTP API request fields for `tenantScope` (unified object)
- Add Studio sample ask controls:
  - Select or paste a mock tenant scope JSON
  - Toggle between enforcement modes
  - See policy errors and tenant warnings clearly
- Document the host integration contract:
  - AskDB receives authorized scope; it does not authenticate users
  - The host is responsible for resolving user identity → tenant scope
  - For polymorphic tables, the host resolves type-specific filters

**Demo:** Run a sample question through CLI or Studio with a scoped user (including advisory context) and see scoped SQL; remove scope and see a policy error; use global scope and see unrestricted results.

## 10 — Schema evolution and re-introspection

- Handle new tables from re-introspection:
  - New tables default to `unknown` classification
  - Trigger a warning in TUI/Studio prompting the integrator to classify them
  - Strict mode blocks queries touching unknown tables until classified
- Handle removed tables:
  - Flag orphaned table references in `tenant-policy.md` as warnings
  - Offer a prune flow in authoring surfaces
- Handle changed FK paths:
  - Detect when a FK used in a propagation path no longer exists
  - Report as a validation error requiring integrator action

**Demo:** Add a new table to the fixture schema, re-load, and see it appear as `unknown` in the coverage report. Run a query touching it and see the appropriate rejection/warning.

## 11 — Documentation

- Add tenant setup recipe:
  - Direct `tenant_id` (P1)
  - Varying column names (P2)
  - Inherited scope via JOINs (P3)
  - Agency/sub-agency hierarchy (P4)
  - Polymorphic tables (P5)
  - Host-expanded IDs vs. subtree scope
  - Global/admin scope
  - Enforcement modes
- Document the unified `TenantScope` contract and all scope kinds
- Document failure modes and why database RLS is still recommended
- Document the tenant-policy.md format with examples
- Cross-link from `docs/roadmap.md`, `docs/mission.md`, and any affected integration docs

**Demo:** A new contributor can follow the recipe against the fixture and reproduce the scoped query behavior.

## 12 — Pack and release prep

- Add a changeset for public API changes:
  - `ask({ tenantScope })` unified input
  - Schema policy types (`TenantPolicy`, `TenantScope`, `TenantFilter`)
  - SQL output modes (SQL-only, SQL+params)
  - Enforcement mode configuration
- Ensure package exports include the new tenant policy types
- Confirm generated package artifacts include any new docs or fixture-adjacent helpers
- Consumer smoke test: import tenant policy types, load the fixture, call `ask()` with mock SQL generation + tenant scope + advisory context, validate scoped output in both output modes

**Demo:** Local package smoke imports the tenant policy types, loads the fixture, calls `ask()` with mock SQL generation, and validates scoped output.

---

**Implementation locus:** likely `packages/core/` for tenant policy loading, prompt assembly, runtime scope, SQL validation, and output modes; `packages/enrich/`, `packages/tui/`, and `apps/studio/` for AI-assisted setup capture; `packages/rag/` for tenant metadata propagation and body chunking; `fixtures/schemas/` for the proof fixture; `apps/cli/` and `apps/http-api/` for minimal surface support.
