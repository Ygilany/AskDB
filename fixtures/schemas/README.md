# Schema fixtures (Phase 1)

Phase 1 accepts a single JSON format: **`AskDB schema v1`**.

- Top level: `{ "version": 1, "tables": [ ... ] }`
- Each table: `name`, `columns[]` with `name`, `type`, optional `nullable`, optional `primaryKey`
- **Phase 2 (additive):** optional `sensitive` on a **table** or **column**. By default, NL→SQL DDL **lists** those identifiers with an `(sensitive)` tag; use CLI **`--omit-sensitive-from-prompt`** or env **`ASKDB_OMIT_SENSITIVE_FROM_PROMPT`** to withhold names (see [`docs/contracts/sensitive-fields-and-modes.md`](../../docs/contracts/sensitive-fields-and-modes.md)). Example: `fixtures/schemas/orders-users-sensitive.schema.json`.

See [`docs/specs/phase-1-schema-sql-cli/requirements.md`](../../docs/specs/phase-1-schema-sql-cli/requirements.md) for product context.
