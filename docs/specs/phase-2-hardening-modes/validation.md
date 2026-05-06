# Validation — Phase 2 merge bar

Implementation is ready to merge when **automated CI** passes and **contract-heavy** behavior is backed by **fixtures or golden-output** tests, per planning input.

## Automated

1. **Turborepo / CI parity**  
   - From repo root: **`pnpm build`** and **`pnpm test`** succeed in the same way as today (tasks declared in Turbo pipeline).  
   - **GitHub Actions** (or equivalent) runs the suite with **PostgreSQL** available wherever Phase 2 still depends on Phase 1 execution paths (`DATABASE_URL` when integration tests apply).

2. **Fixtures / golden-output for contracts**  
   - **Modes:** Tests (or snapshots) proving that mode A vs mode B changes **either** modeled context eligibility, **or** execution/logging branches, as defined in the mode contract—no silent equivalence when the contract says they must differ.  
   - **Observability:** Tests asserting **stable log field names** and presence of **correlation ID** across at least one full CLI-invoked path (unit or integration with process spawn as appropriate). Include at least one test that **configurable log destinations** behave as specified (e.g. logs written to a **temp file** path when configured, or stderr vs stdout split documented in the test name)—so “only works when glued to the terminal” does not slip through.  
   - **Sensitive fields:** Fixture schema with sensitive columns; tests that **default** prompt construction **includes** identifiers (tagged) and that **optional omission** mode withholds them when enabled.

3. **Regression for Phase 1**  
   - Existing Phase 1 scenarios (schemas, validation, execution shape) remain green; Phase 2 must not regress tabular execution or schema v1 ingestion without an explicit bump and docs.

## Manual (short)

- Run CLI documented in `README.md` with **logging** enabled: confirm readable **structured** lines and one **correlation ID** per run. Repeat with logs directed to a **file** (per documented flag/env): confirm the file receives the same JSON lines.  
- Exercise **two modes** on the same question and confirm behavior matches the written contract (including “no bounded data in model context” for strict schema-only mode).  
- Confirm **debug logs** for sensitive handling emit **counts** only (no raw column names in structured logs unless you intentionally log prompts elsewhere).

When **bounded-result summaries** (non-stub) ship, extend automated coverage per [**`docs/contracts/sensitive-fields-and-modes.md`**](../../contracts/sensitive-fields-and-modes.md): row payloads sent to any LLM must have **sensitive columns projected out** unless the contract explicitly documents a different policy.

## Non-blockers for Phase 2 merge

- Shipping MCP or HTTP (Phase 3).  
- Web catalog, describable-schema enrichment UX, embed SDK (Phase 4).  
- Full RAG, multi-engine Postgres alternatives, introspection templates (later phases).

## References

- [`requirements.md`](./requirements.md) — scope and decisions  
- [`plan.md`](./plan.md) — milestone order  
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive fields and future bounded-summary tests  
