# Validation — Phase 10 (multi-tenant proof) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, tenant policy can be captured and loaded from a Schema v2 artifact, `ask({ tenantScope })` is contract-tested, and generated SQL fails closed when tenant scope is missing or unsafe.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root.
   - All Phase 1 through Phase 9 tests remain green.
   - Existing prompt snapshots for schemas with no tenant policy are unchanged.

2. **Tenant policy loading**
   - Fixture policy loads and normalizes deterministically.
   - Unknown table ids, unknown column ids, broken FK paths, and cycles in hierarchy metadata produce clear validation errors.
   - Global/reference tables are represented explicitly and are not accidentally treated as tenant-scoped.

3. **Setup capture**
   - Shared save/load helpers preserve tenant policy round-trip.
   - Studio/TUI flow tests cover confirming tenant roots, direct scoped tables, inherited scoped tables, hierarchy edges, and global tables.
   - Re-opening the schema shows the same tenant coverage report.

4. **Runtime scope contract**
   - `ask()` accepts valid exact-id, subtree, multi-root, and explicit global scopes.
   - `ask()` rejects missing scope when tenant policy exists.
   - `ask()` rejects scopes that reference unknown tenant roots.
   - `global` scope requires an explicit marker/reason and is observable in logs without exposing tenant values.

5. **Prompt assembly**
   - Full-schema prompt snapshots include a deterministic tenant policy block when tenant policy exists.
   - Prompt snapshots include the runtime scope in the agreed compact format.
   - Prompts with no tenant policy remain byte-identical to pre-Phase-10 behavior.
   - Sensitive-field prompt behavior remains unchanged except where tenant metadata explicitly references sensitive columns.

6. **SQL guardrails**
   - Safe SQL with direct tenant predicates passes.
   - Safe SQL with inherited scope through validated joins passes.
   - Safe SQL against global/reference tables passes without tenant predicates.
   - SQL touching tenant-scoped tables without tenant predicates fails.
   - SQL with incompatible tenant joins fails.
   - SQL asking for cross-tenant/global results fails unless runtime scope is explicit `global`.
   - Complex SQL that the validator cannot prove safe fails closed.

7. **RAG parity**
   - RAG-backed prompt assembly includes tenant policy context for retrieved tenant-scoped tables.
   - The same fixture question produces equivalent tenant guardrail outcomes with full-schema prompts and RAG prompts.
   - Tenant metadata needed for validation is not lost during chunking/indexing/retrieval.

8. **Surface integration**
   - CLI proof path can pass tenant scope from a JSON file or equivalent minimal input.
   - HTTP API accepts and validates `tenantScope` in request bodies.
   - Studio sample ask can send a mock tenant scope and shows policy errors clearly.
   - Structured logs identify tenant-policy enforcement events without logging raw tenant ids unless the host explicitly opts into such logging.

9. **Packaging**
   - Public tenant policy and scope types are exported from the intended package.
   - Changeset covers public API or artifact-format changes.
   - Consumer smoke imports the new types and calls `ask()` with a mock model and tenant scope.

## Manual

- Open the multi-tenant fixture in Studio or TUI, confirm the agency/sub-agency tenant policy, save, and reload.
- Ask "show revenue by client this quarter" with an agency-subtree scope; confirm generated SQL includes the required tenant path.
- Repeat without `tenantScope`; confirm AskDB fails before broad SQL can be used.
- Ask for "all agencies" with a non-global scope; confirm a policy error.
- Repeat with explicit `global` scope; confirm the query is allowed and the logs indicate global scope was used.
- Enable RAG and repeat the scoped question; confirm retrieved context still includes tenant policy.

## Non-blockers for Phase 10 merge

- Full production-grade policy engine and host authorization adapters.
- Supporting every possible Postgres query shape.
- Non-Postgres tenant policy enforcement.
- Database RLS generation or migration management.
- `bounded_results` row-data summarization with tenant policy.
- Hosted multi-user policy administration UI.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/roadmap.md`](../../roadmap.md) — Phase 10
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 artifact this phase extends
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — retrieval parity checks
- [`docs/specs/phase-9-studio-revamp/`](../phase-9-studio-revamp/) — Studio setup surface
