# Schema fixtures (Phase 1)

Phase 1 accepts a single JSON format: **`AskDB schema v1`**.

- Top level: `{ "version": 1, "tables": [ ... ] }`
- Each table: `name`, `columns[]` with `name`, `type`, optional `nullable`, optional `primaryKey`

See [`docs/specs/phase-1-schema-sql-cli/requirements.md`](../../docs/specs/phase-1-schema-sql-cli/requirements.md) for product context.
