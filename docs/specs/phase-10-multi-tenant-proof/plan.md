# Plan — Phase 10 (multi-tenant proof) (demoable milestones)

Numbered groups are **ordered** so each milestone is demoable. The proof starts with a fixture and contract because tenant safety is a cross-cutting behavior: schema metadata, prompt assembly, RAG, and SQL validation all need the same vocabulary.

## 1 — Tenant policy contract sketch

- Define the tenant policy data model:
  - tenant roots
  - scoped tables
  - direct tenant columns
  - inherited scope paths through foreign keys
  - hierarchy edges
  - global/unscoped tables
- Decide storage location for the proof (`schema.json` metadata or a colocated policy file).
- Add TypeScript types in the package that owns Schema v2 loading.
- Document the draft shape in `docs/contracts/schema-v2.md` or a new focused contract doc if the schema-v2 contract would become too large.

**Demo:** Load a schema artifact with tenant policy and print a normalized policy summary.

## 2 — Multi-tenant fixture

- Add a fixture schema with:
  - `agencies`
  - sub-agency or parent-agency hierarchy
  - clients/accounts owned through the hierarchy
  - tenant-scoped operational tables
  - one or more global/reference tables
- Include direct-scope examples and inherited-scope examples.
- Add expected policy normalization snapshots.

**Demo:** A test loads the fixture and reports which tables are scoped, inherited, global, or unknown.

## 3 — Setup-time capture in authoring surfaces

- Add shared enrichment helpers for tenant policy draft/load/save.
- Add a focused TUI or Studio flow that asks:
  - is this schema multi-tenant?
  - what table is the tenant root?
  - which columns/relationships carry tenant scope?
  - is there a hierarchy, and which relationship defines parent/child?
  - which tables are intentionally global?
- Require explicit confirmation before tenant enforcement is enabled.
- Surface a coverage report for scoped/global/unknown tables.

**Demo:** Open the fixture in Studio or TUI, confirm the agency/sub-agency policy, save, reload, and see the same coverage report.

## 4 — Runtime `tenantScope` input

- Add a typed `tenantScope` option to `ask()`.
- Support exact tenant ids, subtree scopes, multi-root scopes, and explicit global/admin scope.
- Validate scope shape before prompt generation.
- Add clear errors for:
  - tenant policy exists but no runtime scope was supplied
  - runtime scope references an unknown tenant root
  - `global` scope is used without an explicit reason/marker

**Demo:** Calling `ask()` against the fixture without scope fails before model generation; calling it with a valid agency scope proceeds to prompt assembly.

## 5 — Prompt assembly boundary

- Add a tenant policy section to full-schema prompt assembly.
- Include runtime scope in a compact, deterministic format.
- Keep the wording strict: every tenant-scoped table must be constrained to the current user's allowed scope.
- Define the desired SQL style for tenant predicates and hierarchy joins.
- Add golden prompt tests for:
  - no tenant policy
  - policy + exact tenant ids
  - policy + subtree scope
  - policy + global scope

**Demo:** Snapshot the prompt for "show revenue by client this quarter" and verify the tenant policy block is present.

## 6 — SQL guardrail validator

- Implement conservative Postgres SQL checks for generated `SELECT` statements.
- Detect referenced tables and aliases.
- For each tenant-scoped table, verify the required tenant predicate or validated inherited join path exists.
- Reject cross-tenant/global language unless runtime scope is `global`.
- Reject queries when validation cannot prove scope safety.
- Return clear policy errors with table ids and missing scope paths where safe.

**Demo:** Feed validator fixtures with safe and unsafe SQL. Missing `agency_id`/scope joins fail closed; correctly scoped SQL passes.

## 7 — RAG propagation

- Ensure tenant policy metadata is available after RAG retrieval.
- Attach required scope roots to chunks for tenant-scoped tables where useful.
- Update synthesized DDL prompt assembly so focused prompts include tenant policy context for every retrieved scoped table.
- Add tests showing RAG-backed prompts enforce the same tenant policy as full-schema prompts.

**Demo:** Ask the fixture with a retriever enabled; the focused prompt still includes the tenant policy block and generated SQL is validated against scope.

## 8 — CLI/HTTP/Studio integration surfaces

- Decide minimal CLI support for proofing tenant scope, likely a JSON file flag rather than many flags.
- Add HTTP API request fields for `tenantScope`.
- Add Studio sample ask controls for selecting or pasting a mock tenant scope.
- Keep host-owned auth clear in docs: AskDB receives authorized scope; it does not authenticate users.

**Demo:** Run a sample question through CLI or Studio with a scoped user and see scoped SQL; remove scope and see a policy error.

## 9 — Documentation

- Add tenant setup recipe:
  - direct `tenant_id`
  - agency/sub-agency hierarchy
  - host-expanded ids vs. subtree scope
  - global/admin scope
- Document failure modes and why database RLS is still recommended.
- Cross-link from `docs/roadmap.md`, `docs/mission.md`, and any affected integration docs.

**Demo:** A new contributor can follow the recipe against the fixture and reproduce the scoped query behavior.

## 10 — Pack and release prep

- Add a changeset for any public API changes (`ask({ tenantScope })`, schema policy types).
- Ensure package exports include the new tenant policy types.
- Confirm generated package artifacts include any new docs or fixture-adjacent helpers that consumers need.

**Demo:** Local package smoke imports the tenant policy types, loads the fixture, calls `ask()` with mock SQL generation, and validates scoped output.

---

**Implementation locus:** likely `packages/core/` for tenant policy loading, prompt assembly, runtime scope, and SQL validation; `packages/enrich/`, `packages/tui/`, and `apps/studio/` for setup capture; `packages/rag/` for tenant metadata propagation; `fixtures/schemas/` for the proof fixture; `apps/cli/` and `apps/http-api/` for minimal surface support.
