# Validation — Phase 10 (multi-tenant proof) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions), **[`plan.md`](./plan.md)** (milestones), and **[`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md)** (format contract).

Implementation is ready to merge when **automated CI** passes, tenant policy can be captured and loaded from a `tenant-policy.md` artifact, `ask({ tenantScope })` is contract-tested with the unified scope object, and generated SQL fails closed (strict) or flags warnings (warn) when tenant scope is missing or unsafe.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root.
   - All Phase 1 through Phase 9 tests remain green.
   - Existing prompt snapshots for schemas with no tenant policy are unchanged (byte-identical).

2. **Tenant policy loading**
   - Fixture `tenant-policy.md` loads and normalizes deterministically.
   - Front-matter is parsed by zod with the expected shape (roots, hierarchy, scopedTables, polymorphicTables, globalTables, enforcement).
   - Unknown table IDs, unknown column IDs, broken FK paths, and cycles in hierarchy metadata produce clear validation errors.
   - Global/reference tables are represented explicitly and are not accidentally treated as tenant-scoped.
   - Unknown tables are tracked separately and visible in the coverage report.
   - Cross-reference validation against `schema.json` reports mismatched IDs as errors.

3. **Discriminator pattern coverage**
   - P1 (single direct column): `orders.agency_id` → direct scope verified.
   - P2 (varying column names): `campaigns.owning_agency` → same root, different column name verified.
   - P3 (inherited via JOINs): `appointments` → `clients` → scope inherited through FK chain verified.
   - P4 (multi-level hierarchy): agency → sub_agency → client traversal verified in policy normalization.
   - P5 (polymorphic): `notes.owner_type` + `notes.owner_id` → type-to-root mapping verified.

4. **Setup capture (AI-assisted)**
   - Shared save/load helpers preserve `tenant-policy.md` round-trip (front-matter + body).
   - AI draft generation produces a valid policy from the fixture's FK graph.
   - Studio/TUI flow tests cover per-section confirmation: tenant roots, hierarchy edges, direct-scope tables, inherited-scope tables, polymorphic tables, global tables, enforcement mode.
   - Coverage report classifies every fixture table as scoped / inherited / polymorphic / global / unknown.
   - Re-opening the schema shows the same coverage report.
   - Saving without confirming all sections is blocked (no partial policy).

5. **Runtime scope contract**
   - `ask()` accepts valid scope kinds: ids, subtree, multi_root, and explicit global.
   - `ask()` rejects missing scope when tenant policy exists.
   - `ask()` rejects scopes that reference unknown tenant roots.
   - `global` scope requires an explicit reason and is observable in logs without exposing tenant values.
   - `tenantFilters` are validated against polymorphic table definitions in the policy.
   - Advisory `context` (role, region, department, label, description, attributes) passes through to prompt assembly without validation errors.
   - Unknown `context` keys in `attributes` are accepted (freeform).

6. **Prompt assembly**
   - Full-schema prompt snapshots include a deterministic tenant policy block when tenant policy exists.
   - Policy front-matter (roots, hierarchy, scoped tables, polymorphic mappings, global tables) is always present in the prompt.
   - Runtime scope is included in the agreed compact format.
   - Advisory context (role, region, etc.) is included when provided.
   - Named placeholder convention (`:tenant_<root_label>_ids`) is documented in the prompt instruction block.
   - Prompts with no tenant policy remain byte-identical to pre-Phase-10 behavior.
   - Sensitive-field prompt behavior remains unchanged except where tenant metadata explicitly references sensitive columns.
   - Golden prompt tests cover: no policy, policy + ids, policy + subtree, policy + multi_root, policy + global, policy + advisory context, policy + polymorphic tables.

7. **SQL guardrails**
   - **Parser-based validation:**
     - Safe SQL with direct tenant predicates passes (P1, P2).
     - Safe SQL with inherited scope through validated joins passes (P3).
     - Safe SQL against global/reference tables passes without tenant predicates.
     - SQL touching tenant-scoped tables without tenant predicates fails.
     - SQL with incompatible tenant joins fails (cross-table scope mismatch).
     - SQL touching polymorphic tables without type discriminator fails.
     - SQL asking for cross-tenant/global results fails unless runtime scope is explicit `global`.
     - Aggregation queries within user's scope pass; cross-scope aggregation without global fails.
     - Complex SQL that the validator cannot prove safe fails closed (strict) or is flagged (warn).
   - **Heuristic fallback:**
     - SQL the parser cannot handle falls through to heuristic checks.
     - Heuristic checks apply conservative pattern matching.
     - Unprovable SQL is rejected (strict) or flagged with `tenantWarnings` (warn).
   - **Unknown table handling:**
     - Queries touching unknown tables are rejected (strict) or flagged (warn).
   - **Enforcement modes:**
     - `strict` mode rejects unsafe SQL with clear policy errors (table IDs, missing scope paths).
     - `warn` mode returns SQL with `tenantWarnings` array.
     - Mode is configurable per schema and respected consistently.

8. **SQL output modes**
   - SQL-only mode: named placeholders replaced with literal values. Output is executable SQL.
   - SQL+params mode: named placeholders converted to positional params. Output is `{ sql, params, tenantBindings }`.
   - Both modes produce equivalent query semantics.
   - Validator operates before placeholder replacement (validates the templated SQL).
   - Mode is configurable per `ask()` call.

9. **RAG parity**
   - Tenant policy front-matter is always injected into prompts regardless of RAG retrieval.
   - Tenant policy body prose is chunked and retrievable.
   - RAG-backed prompt assembly includes full tenant policy front-matter for retrieved tenant-scoped tables.
   - The same fixture question produces equivalent tenant guardrail outcomes with full-schema prompts and RAG prompts.
   - Tenant metadata needed for validation is not lost during chunking/indexing/retrieval.
   - Chunk IDs for tenant policy body follow the deterministic scheme.

10. **Schema evolution**
    - New tables from re-introspection default to `unknown` classification.
    - Unknown tables trigger a warning in authoring surfaces.
    - Removed tables are flagged as orphaned in tenant policy.
    - Changed FK paths invalidating propagation paths produce validation errors.
    - Coverage report updates to reflect schema changes.

11. **Surface integration**
    - CLI proof path can pass tenant scope from a JSON file (`--tenant-scope`).
    - HTTP API accepts and validates `tenantScope` (unified object) in request bodies.
    - Studio sample ask can send a mock tenant scope (including advisory context) and shows policy errors and tenant warnings clearly.
    - Structured logs identify tenant-policy enforcement events without logging raw tenant IDs unless the host explicitly opts into such logging.
    - Advisory context `role` is logged; other context fields are not logged by default.

12. **Packaging**
    - Public tenant policy and scope types are exported from the intended package.
    - Types include: `TenantPolicy`, `TenantScope`, `TenantFilter`, `TenantRoot`, `HierarchyEdge`, `ScopedTable`, `PolymorphicTable`.
    - Changeset covers public API and artifact-format changes.
    - Consumer smoke imports the new types and calls `ask()` with a mock model, tenant scope (including advisory context), and validates output in both SQL modes.

## Manual

- Open the multi-tenant fixture in Studio or TUI, see the AI-drafted policy, confirm each section (roots, hierarchy, scoped tables, polymorphic, global), save, and reload.
- Ask "show revenue by client this quarter" with an agency-subtree scope; confirm generated SQL includes the required tenant path and uses named placeholders.
- Repeat without `tenantScope`; confirm AskDB fails before broad SQL can be used.
- Ask for "all agencies" with a non-global scope; confirm a policy error.
- Repeat with explicit `global` scope; confirm the query is allowed and the logs indicate global scope was used.
- Ask a question touching the `notes` table (polymorphic); confirm generated SQL includes the type discriminator.
- Ask a question touching an unknown/unclassified table in strict mode; confirm rejection.
- Switch to warn mode and repeat; confirm SQL is returned with `tenantWarnings`.
- Test SQL+params output mode; confirm `{ sql, params, tenantBindings }` shape.
- Enable RAG and repeat the scoped question; confirm the focused prompt includes the full tenant policy front-matter and generated SQL is validated against scope.
- Test with advisory context (role: "regional_manager", region: "northeast"); confirm it appears in the prompt.

## Non-blockers for Phase 10 merge

- Full production-grade policy engine and host authorization adapters.
- Recursive CTE generation for subtree scope resolution (documented, not implemented).
- Composite tenant key validation (pattern documented, not validated).
- Supporting every possible Postgres query shape (fail-closed is acceptable).
- Non-Postgres tenant policy enforcement.
- Database RLS generation or migration management.
- `bounded_results` row-data summarization with tenant policy.
- Hosted multi-user policy administration UI.
- LLM-assisted validation (two-pass) — parser + heuristic is the chosen strategy.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/tenant-policy.md`](../../contracts/tenant-policy.md) — tenant policy format contract
- [`docs/roadmap.md`](../../roadmap.md) — Phase 10
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 artifact this phase extends
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — retrieval parity checks
- [`docs/specs/phase-9-studio-revamp/`](../phase-9-studio-revamp/) — Studio setup surface
