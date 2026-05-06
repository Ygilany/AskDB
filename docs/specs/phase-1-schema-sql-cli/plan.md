# Plan — Phase 1 (core → CLI)

Numbered groups follow **shared core first**, then Postgres execution, then CLI, then docs and smoke. Dependencies flow downward.

## 1 — Repository and packages

- Initialize **pnpm workspace** monorepo layout (`platform.md`): e.g. `packages/core`, `packages/cli` (names may vary; keep boundaries clear).
- Add baseline tooling: TypeScript config, linter/formatter placeholders consistent with repo conventions once chosen.
- Document how to install and run from root (`README.md` pointers).

## 2 — Schema ingest and normalization (core)

- Implement the **single** Phase 1 schema format: parse/normalize into an internal **describable-schema-ready** representation (technical fields sufficient for Phase 1; enrichment UI is later).
- Add **fixtures** under a stable path (e.g. `fixtures/schemas/`) referenced by tests.
- **Unit tests** for parser and normalization edge cases.

## 3 — NL → SQL pipeline (core)

- Implement prompt/build and model call plumbing with **BYO** keys (`mission.md`).
- Add **SQL validation / guardrails** (syntax, dialect assumptions for Postgres, basic allow/deny lists appropriate for dev).
- **Unit tests** with mocked model responses covering: happy path, validation rejection, ambiguous schema messaging.
- Optional: deterministic “golden” SQL snippets for fixture-driven tests without live LLM where feasible.

## 4 — Postgres execution (core)

- Implement configurable **PostgreSQL** connection and query execution returning **tabular** data (typed rows/columns serialization for CLI).
- **Integration tests** against PostgreSQL (local `DATABASE_URL` or CI service); include setup notes in docs.
- Handle execution errors distinctly from generation errors.

## 5 — CLI surface

- Thin **CLI**: arguments/env for schema path, question, DB config, verbosity.
- Single command flow: load schema → generate → validate → execute → emit **tabular output** (e.g. TSV/table text or structured JSON flag—pick one primary for Phase 1, document alternate).
- **Smoke path** documented in `validation.md` and README.

## 6 — Documentation and polish

- Update **`README.md`**: prerequisites, env vars, example session, limitation callouts (Phase 1 dev scope).
- Cross-link this spec ([`requirements.md`](./requirements.md)) and validation ([`validation.md`](./validation.md)).
- Confirm roadmap Phase 1 checkboxes mentally: demoable end-to-end **CLI** on **one** schema format.
