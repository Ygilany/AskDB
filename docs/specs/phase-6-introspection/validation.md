# Validation — Phase 6 (Schema introspection) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, **determinism is contract-tested**, **live and air-gapped paths produce identical artifacts**, and **ID-anchored re-introspection** preserves the describable layer per the contract.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity unchanged).
   - All Phase 1 / 2 / 2.5 / 3 / 4 / 5 tests remain green.

2. **Connector contract tests** (`packages/introspect/`)
   - The Postgres connector produces a stable `SqlSchema` from the pinned catalog snapshot (`fixtures/introspect/orders-users.catalog.json`) — golden file test.
   - Multi-column foreign keys preserve `pg_constraint.conkey` order (regression guard for the documented Drizzle bug).
   - Enum values preserve `pg_enum.enumsortorder`.
   - Filters work consistently: `schemas`, `excludeSchemas`, `tables` glob; system schemas are always excluded.

3. **Determinism**
   - Two runs of the connector on the same catalog snapshot produce a byte-identical `SqlSchema` JSON.
   - Two end-to-end live runs against the same Pagila DB (CI-gated, requires Postgres) produce a byte-identical `schema.json`.
   - Renderer ordering is stable across OS / Node version / file system ordering.

4. **Live + air-gapped equivalence**
   - Round-trip: export the catalog snapshot's rows into a CSV bundle on disk; run `--from-export` against the bundle; assert the resulting `schema.json` is byte-identical to the one produced by live mode against the same data.
   - Bundle validation: missing files, malformed manifest, and unknown engine all produce clear errors with `IntrospectionWarning` entries (not silent failures).

5. **ID-anchored re-introspection** — given an existing `<schemaId>.schema/` directory:
   - Re-running with no DB change produces zero diff in `schema.json`.
   - Adding a column produces a `schema.json` whose existing IDs are unchanged; the new column has a fresh id; one `IntrospectionWarning` of code `new_column`.
   - Removing a column referenced by a `tables/<x>.md` file: `schema.json` drops the column; the `tables/<x>.md` file is **byte-identical on disk before and after** the run; one `IntrospectionWarning` of code `orphan_id` references the affected file.
   - Sensitive flags previously set in `schema.json` are preserved across runs.
   - The describable layer is **never written or modified**, even when warnings reference it.

6. **CLI smoke**
   - `askdb introspect --url <fake-executor>` produces an artifact (uses a mocked executor; no live DB required for unit-level CLI tests).
   - `askdb introspect --from-export <bundle>` produces an identical artifact.
   - `askdb introspect --diff <existing>` prints a structured diff and writes nothing.
   - `askdb introspect --print` writes to stdout and creates no files.
   - `askdb introspect templates --engine postgres` prints the canonical SQL suite.
   - Spawn-based test asserts JSON log lines with stable `event` and `correlationId` under `askdb.introspect.*` (Phase 2.5 conventions).

7. **Pack and metadata for `@askdb/introspect`**
   - `pnpm pack` produces a tarball that excludes test files and includes `dist/`, `README.md`, `LICENSE`.
   - `package.json` has correct `bin`, `engines`, `repository`, `license`, `peerDependenciesMeta` (none required for Phase 6 — `pg` stays in `@askdb/core`).
   - The downstream consumer smoke test from Phase 4 is extended to install `@askdb/introspect` and run `askdb-introspect --version` plus `templates --engine postgres`.

## Manual (short)

- Against a real Pagila instance: run `askdb introspect --url $DATABASE_URL --out /tmp/pagila.schema/`. Inspect the generated `schema.json`. Confirm:
  - All expected tables present.
  - Stable IDs (`table:public.<name>` and `table:public.<name>#<col>`).
  - Multi-column FKs (e.g. `film_actor.(actor_id, film_id)` → `actor.actor_id`, `film.film_id`) preserve declared column order.
  - Enum-like columns (if any) capture values in the database's declared order.
  - Two runs produce no diff.
- Re-run `askdb introspect templates --engine postgres > /tmp/templates.sql`. Open in `psql`, run each template, save the rows as CSVs in a bundle directory. Run `askdb introspect --from-export /tmp/bundle/` and confirm the produced `schema.json` is byte-identical to the live-mode output.
- Run the Phase 7 TUI (when available) against `/tmp/pagila.schema/`; confirm it opens, walks tables, and re-introspection ingestion (Phase 7) flags new columns as un-described.

## Non-blockers for Phase 6 merge

- Non-Postgres engines (Phase 10).
- Heuristic rename detection.
- Capturing every Postgres feature in Schema v2 (RLS, partitioning, expression indexes, generated columns).
- Auto-detecting sensitive columns.
- Live introspection from inside the Phase 7 TUI (the canonical flow remains `askdb introspect → askdb-tui`).

## References

- [`requirements.md`](./requirements.md) — scope, decisions, connector contract, SQL suite
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format contract this phase writes
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive flag preservation
- [`docs/specs/phase-4-publish-npm/`](../phase-4-publish-npm/) — `AskDbExecutor` seam reused for live mode
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — v2 reader/writer this phase writes against
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — downstream consumer
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — downstream consumer
- [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](../postgres-introspection-for-askdb-schema-v1.md) — superseded; reference SQL still cited
