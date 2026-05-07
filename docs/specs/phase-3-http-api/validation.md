# Validation — Phase 3 (HTTP API) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when it is **integration-ready**: a stable contract, examples, and tests proving parity on key flows.

## Automated

1. **Contract tests**
   - Success response shape matches the spec (required fields present).
   - Error response shape matches the spec (stable `code`, message, details) and uses consistent HTTP status codes.
   - Correlation behavior is tested (accepted inbound ID or generated; returned in response).
   - Mode selection is tested (request field/header → core wiring).

2. **CLI parity (contract level)**
   - At least one test proves that, for a fixture schema + deterministic “no live LLM” path (mocked generation or golden SQL), the HTTP surface returns the same SQL/validation outcome as the CLI/core contract expects.

3. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity).

## Manual (short)

- Run the server locally and execute the documented curl example(s).
- Confirm logs are structured and include the `correlationId` and phase-2-aligned event fields.

## Non-blockers for Phase 3 merge

- MCP server surface (Phase 3.5 in `docs/roadmap.md`).
- Web app/catalog/embed work (Phase 4+).

