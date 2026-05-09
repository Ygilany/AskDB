# Plan — Phase 6 (Schema introspection) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable**. The connector lands first because everything else (renderer, merge, CLI) depends on its `SqlSchema` output.

## 1 — `@askdb/introspect` package skeleton + types

- `packages/introspect/` workspace package: `package.json`, ESM, depends on `@askdb/core` (for the `AskDbExecutor` type and the Phase 5 v2 reader used during merge).
- Sub-exports planned: `.` (public types, `introspect()`, renderer), `./postgres` (the Postgres connector).
- `bin: { "askdb-introspect": "./dist/bin.js" }`.
- TypeScript build mirrors `@askdb/core` (`tsconfig.build.json`; emits `dist/`).
- Define and export `SqlSchema`, `IntrospectionInput`, `IntrospectionResult`, `IntrospectionWarning`, `IntrospectionFilters`, and the `Connector` interface from the public entry.

**Demo:** `pnpm build` produces `packages/introspect/dist/index.js` with the expected exports; `pnpm pack` produces a tarball; the package installs alongside `@askdb/core` in the consumer smoke test from Phase 4.

## 2 — Postgres connector — catalog SQL + intermediate `SqlSchema`

- Implement the SQL templates suite per [`requirements.md`](./requirements.md) §4. Each template is a parameterized SQL string, embedded as a constant; the connector also exposes them via `Connector.templates()` for the air-gapped path.
- Implement `describePostgres({ executor, filters })` running the templates via `executor.run(sql, params)` and folding the rows into `SqlSchema`.
- **Determinism guards** built into every query:
  - Explicit `ORDER BY` clauses on every result set (schema, table, column ordinal, constraint name, `conkey` position, enum sort order).
  - FK column lists preserve `pg_constraint.conkey` order; FK referenced lists preserve `confkey` order.
  - Enum values preserve `pg_enum.enumsortorder`.
- Capture (but don't yet emit into v2) check constraints, RLS flags, and view definitions in `IntrospectionResult.viewDefinitions`.
- Catalog snapshot test fixture: pin the result rows from running the templates against a Pagila-like DB (`fixtures/introspect/orders-users.catalog.json`).
- Unit tests run the connector against the snapshot (no live DB) and assert exact `SqlSchema` output, including:
  - Multi-column foreign keys preserve declared order.
  - Enum values preserve declared sort order.
  - Two runs produce a byte-identical `SqlSchema` JSON.

**Demo:** `pnpm test` for the connector reads the catalog snapshot, runs the connector via a fake `AskDbExecutor`, and produces a stable `SqlSchema`.

## 3 — Renderer: `SqlSchema` → Schema v2 `schema.json` (clean write)

- Implement `renderToSchemaV2(schema, { outDir, schemaId })` for the **no-existing-artifact** case.
- Use Phase 5's ID conventions exactly (`table:<schema>.<name>`, `table:<schema>.<name>#<col>`).
- Deterministic output: schemas alphabetical, tables alphabetical within a schema, columns in `ordinalPosition`, FKs by constraint name.
- Tests:
  - Render the catalog snapshot's `SqlSchema` and compare against a golden `fixtures/schemas/orders-users.schema/schema.json` (the same fixture Phase 5 hand-authored — Phase 6's renderer must reproduce its physical layer).
  - Two render runs are byte-identical.

**Demo:** `askdb-introspect --url postgres://... --out my-app.schema/` (or the library equivalent) produces a `schema.json` the Phase 5 loader accepts; running it twice produces no diff.

## 4 — End-to-end live mode through `AskDbExecutor`

- Wire `introspect({ mode: "live", executor, filters }, renderOptions)` end to end: connector → `SqlSchema` → renderer → `IntrospectionResult` + on-disk artifact.
- Reuse Phase 4's `createPostgresExecutor` factory — the integrator passes either a connection string (factory builds the executor) or a custom executor (e.g. postgres.js, Neon HTTP).
- Integration test (CI-gated, requires Postgres) against the project's existing Pagila fixture: introspect → load via Phase 5 reader → assert tables/columns match the gold fixture.

**Demo:** With `DATABASE_URL` set in CI, `askdb introspect --url $DATABASE_URL --out /tmp/pagila.schema/` produces a v2 directory the Phase 5 reader loads cleanly.

## 5 — Air-gapped mode: SQL templates + bundle ingestion

- Implement `Connector.templates()` returning the same SQL the live path runs.
- Implement bundle reader: `--from-export ./bundle/` accepts a directory containing one CSV (preferred) or JSON file per template plus a small `manifest.json`.
- The connector's `describe({ mode: "from-export", bundlePath })` reads the bundle's CSV/JSON and folds rows into the same `SqlSchema` as live mode.
- New CLI subcommand `askdb introspect templates --engine postgres` prints the SQL suite for users to run in `psql`/IDE/CI.
- Tests:
  - Round-trip: produce a bundle from the catalog snapshot (export it as CSVs); ingest via `--from-export`; assert identical `SqlSchema` to live mode.
  - Manifest validation: missing files, unknown engine, version mismatch all produce clear errors.

**Demo:** A test exports the snapshot's catalog rows as CSVs into a temp dir, runs `askdb introspect --from-export <dir>`, and produces an artifact byte-identical to the live-mode artifact.

## 6 — ID-anchored re-introspection merge

- Extend the renderer to accept `existingArtifactDir`; when supplied, run the merge logic per [`requirements.md`](./requirements.md) §6.
- Read the existing `schema.json` (and `tables/*.md` only for orphan-warning detection) via the Phase 5 reader.
- Preserve sensitive flags from the existing `schema.json`.
- Emit `IntrospectionWarning` entries for orphan IDs and new column IDs.
- **Never write anything outside `schema.json`.**
- Tests:
  - Add a column, re-introspect: existing IDs unchanged; new column has a fresh id; `tables/*.md` untouched on disk; one `new_column` warning.
  - Remove a column referenced by `tables/orders.md`: `schema.json` drops the column; `tables/orders.md` unchanged; one `orphan_id` warning.
  - Change a column's type in the DB: existing id unchanged, type updated; sensitive flag from `schema.json` preserved.
  - Run twice with no DB change: zero diff in `schema.json`.

**Demo:** A test simulates a column-add followed by re-introspection; the resulting `schema.json` has the new column with a fresh id and the existing `tables/orders.md` is untouched.

## 7 — CLI surface + structured logging

- `askdb introspect --url …` (live), `askdb introspect --from-export …` (air-gapped), `askdb introspect --diff …` (no writes), `askdb introspect --print` (stdout), `askdb introspect templates --engine postgres` (dump SQL).
- Also publish a standalone `askdb-introspect` binary in the package; `askdb introspect` is a thin shim in `@askdb/cli`.
- Reuse Phase 2 logging conventions: structured events with `correlationId`; events under `askdb.introspect.*` (e.g. `askdb.introspect.started`, `askdb.introspect.completed`, `askdb.introspect.warning`).
- Tests:
  - CLI smoke tests with a fake executor (no live DB) cover `--url` (mocked executor), `--from-export`, `--diff`, `--print`, and `templates`.
  - Spawn-based test asserts JSON log lines with stable `event` and `correlationId` (consistent with Phase 2.5).

**Demo:** A new contributor can run `askdb introspect templates --engine postgres > queries.sql`, run them in `psql`, save the rows, and run `askdb introspect --from-export <dir>` without writing any code.

## 8 — Documentation

- `packages/introspect/README.md` with two-mode quickstart.
- `docs/integration/installable-package.md` updated with the canonical `introspect → enrich` flow leading into Phase 7's TUI.
- Update [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](../postgres-introspection-for-askdb-schema-v1.md) with a top-of-doc "superseded by Phase 6" banner pointing here. The SQL queries remain referenceable; this phase's `requirements.md` now embeds the canonical versions.

**Demo:** Following `packages/introspect/README.md`, a consumer wires either path and produces an enriched-ready v2 artifact.

## 9 — Pack + publish prep

- `pnpm pack` for `@askdb/introspect` excluding test files; verify `bin`, `engines`, `repository`, `license`.
- Extend the Phase 4 consumer install smoke to install `@askdb/introspect` and run `askdb-introspect --version` plus `templates --engine postgres`.
- Add a changeset for the v0.1.0 release of `@askdb/introspect` (lockstep with `@askdb/core` if any cross-package types changed).

**Demo:** `pnpm pack` produces a clean tarball; the smoke test installs and uses `@askdb/introspect` without errors.

---

**Implementation locus:** `packages/introspect/` (new package), `packages/cli/` (`askdb introspect` shim), `fixtures/introspect/` (catalog snapshot), `fixtures/schemas/orders-users.schema/` (golden physical layer), `docs/integration/`. No changes to `@askdb/core` beyond consuming the existing Phase 4 + Phase 5 surfaces.
