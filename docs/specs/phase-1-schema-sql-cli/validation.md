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
   - From the repo root: **`pnpm build`** and **`pnpm test`** run via **Turborepo** (declared task graph + caching). Integration runs when `DATABASE_URL` is set (CI sets it).  
   - **GitHub Actions:** [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) runs those commands with a Postgres service and sets `DATABASE_URL` so the integration test is not skipped.

## Manual (short)

- **Generate only:** after `pnpm install && pnpm build`, run the CLI example in [`README.md`](../../../README.md) against `fixtures/schemas/orders-users.schema.json` with `OPENAI_API_KEY` set (or use `pnpm exec askdb init` and create a `.env` / adjust `env("...")` in `askdb.config.ts` per [`@askdb/config`](../../../packages/config/README.md)).  
- **Execute:** set `DATABASE_URL` to a dev database, add `--execute`, confirm TSV or `--json` output.  
- Confirm error messages for: bad connection, unsafe/rejected SQL, missing schema file, missing `OPENAI_API_KEY`, or `--execute` without `DATABASE_URL`.

## Non-blockers for Phase 1 merge

- Structured logging and **trace/correlation IDs** (tracked in **Phase 2** per [`docs/roadmap.md`](../../roadmap.md)).  
- MCP, HTTP API, web UI, non-Postgres engines.

## References

- [`requirements.md`](./requirements.md) — scope and testing strategy  
- [`plan.md`](./plan.md) — implementation order  
- Phase 2 merge bar: [`docs/specs/phase-2-hardening-modes/validation.md`](../phase-2-hardening-modes/validation.md)  
