# Schema fixtures (Phase 1)

Phase 1 accepts a single JSON format: **`AskDB schema v1`**.

- Top level: `{ "version": 1, "tables": [ ... ] }`
- Each table: `name`, `columns[]` with `name`, `type`, optional `nullable`, optional `primaryKey`
- **Phase 2 (additive):** optional `sensitive` on a **table** or **column**. By default, NL→SQL DDL **lists** those identifiers with an `(sensitive)` tag; use CLI **`--omit-sensitive-from-prompt`** or env **`ASKDB_OMIT_SENSITIVE_FROM_PROMPT`** to withhold names (see [`docs/contracts/sensitive-fields-and-modes.md`](../../docs/contracts/sensitive-fields-and-modes.md)). Example: `fixtures/schemas/orders-users-sensitive.schema.json`.

**Roadmap (Phase 6 — `@askdb/introspect`):** generating a Schema v2 physical artifact from a live Postgres instance lands as the dedicated `@askdb/introspect` package with two equally-supported front doors: a **live** connection (BYO executor) and an **air-gapped** path (run documented `pg_catalog`/`information_schema` SQL in `psql`/CI/IDE, hand AskDB the export bundle). Both produce identical artifacts. Spec: [`docs/specs/phase-6-introspection/`](../../docs/specs/phase-6-introspection/). Reference SQL (still cited; superseded by Phase 6): [`docs/specs/postgres-introspection-for-askdb-schema-v1.md`](../../docs/specs/postgres-introspection-for-askdb-schema-v1.md).

**Schema v2 (Phase 5):** the format described above is the pre-v2 internal format that ships through Phase 4. **Phase 5 introduces Schema v2 as a breaking change** (no migrator; pre-1.0); see [`docs/contracts/schema-v2.md`](../../docs/contracts/schema-v2.md) for the post-Phase-5 format.

See [`docs/specs/phase-1-schema-sql-cli/requirements.md`](../../docs/specs/phase-1-schema-sql-cli/requirements.md) for product context.
