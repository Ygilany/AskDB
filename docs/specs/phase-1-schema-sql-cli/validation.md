# Validation — Phase 1 merge bar

Implementation is ready to merge when all of the following hold. This encodes an **automated-first** bar (per spec input); manual steps are supplementary.

## Automated

1. **Unit tests**  
   - Parser / schema normalization.  
   - SQL validation and guardrail behavior.  
   - Core NL→SQL orchestration with **mocked** or deterministic model inputs where live LLM is not viable in CI.

2. **Integration tests (PostgreSQL)**  
   - At least one test that connects to Postgres (via `DATABASE_URL` or testcontainer-style setup—documented in repo).  
   - Asserts: successful round-trip **execute** of a known-safe query and correct **tabular** result shape (not just “no throw”).

3. **CI-ready script**  
   - A single documented command (e.g. `pnpm test` or `pnpm -r test`) that runs unit + integration suites.  
   - CI configuration may be added in the same PR or immediately after; the **script** must exist so CI is trivial to wire.

## Manual (short)

- Run the **documented CLI example** from a clean checkout (or equivalent): schema fixture + local Postgres + one NL question → SQL + results.  
- Confirm error messages for: bad connection, rejected SQL, missing schema file.

## Non-blockers for Phase 1 merge

- Structured logging and **trace/correlation IDs** (tracked in **Phase 2** per [`docs/roadmap.md`](../../roadmap.md)).  
- MCP, HTTP API, web UI, non-Postgres engines.

## References

- [`requirements.md`](./requirements.md) — scope and testing strategy  
- [`plan.md`](./plan.md) — implementation order  
