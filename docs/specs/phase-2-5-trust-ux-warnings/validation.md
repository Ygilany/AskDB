# Validation — Phase 2.5 merge bar (high)

Pair with [`requirements.md`](./requirements.md) (scope/decisions) and [`plan.md`](./plan.md) (ordered milestones).

Ready to merge when **automated CI** proves the new behavior and regressions are unlikely.

## Automated (required)

1. **Repo CI parity**
   - From repo root: `pnpm build` and `pnpm test` succeed.

2. **Spawn / smoke test: CLI structured logs (no live LLM)**
   - A test runs `askdb` as a subprocess using a **mock provider** (no `OPENAI_API_KEY`).
     - Preferred mechanism: `--mock-sql "<sql>"` or `ASKDB_MOCK_SQL`.
   - Logs are captured deterministically (prefer `--log-file <tmp>` or equivalent).
   - The captured JSONL parses successfully.
   - Every record includes required fields (minimum):
     - `event`
     - `correlationId`
   - The run includes (at least once) the required event set chosen in the plan (run start/end plus generation/validation milestones).

3. **Hard failure on log schema drift**
   - Tests fail if required fields are missing or renamed.
   - Additive fields/events must not fail the suite.

4. **Richer CLI errors coverage**
   - At least one test asserts error output includes:
     - the user-provided schema path (when relevant)
     - an actionable hint (fixture path, “expected schema JSON v1”, or similar)

5. **Sensitive-column warning coverage**
   - At least one test asserts that when generated SQL references a sensitive-marked column:
     - a structured warning event is emitted (stable `event` name)
       - event name (v1): `askdb.pipeline.sensitive_sql_warning`
     - a human-readable warning appears on stderr
   - The warning must not include any row values (identifiers only).

## Manual (quick sanity)

- Run a single CLI query locally (real provider if desired) and confirm:
  - logs remain JSONL and correlate under one `correlationId`
  - a sensitive-column reference yields a visible warning
  - a bad schema path yields a helpful error referencing the file path

## Non-blockers

- MCP/HTTP surface (Phase 3).
- Web UI/catalog/enrichment (Phase 4).
- `bounded_results` non-stub summarization and any row-to-LLM payload flow.

## References

- Phase 2.5 roadmap bullets: [`docs/roadmap.md`](../../roadmap.md)
- Mission principles: [`docs/mission.md`](../../mission.md)
- Platform baseline: [`docs/platform.md`](../../platform.md)

