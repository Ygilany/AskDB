# Schema Fixtures

The maintained fixture path is **AskDB Schema v2**. Use the split directory form for local development and docs examples:

```text
orders-users.schema/
  schema.json
  tables/
    orders.md
    users.md
  concepts.md
```

Run a known-good local question with:

```bash
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many orders are there?"
```

Schema v2 can also be bundled into a single JSON file and loaded through the same `loadSchema` / `askdb ask --schema` paths. See [`docs/contracts/schema-v2.md`](../../docs/contracts/schema-v2.md) for the current contract.

## Legacy v1 Fixtures

Some JSON files in this directory are legacy fixtures retained for regression coverage of pre-v2 parsing and migration behavior. The legacy shape is:

- Top level: `{ "version": 1, "tables": [ ... ] }`
- Each table: `name`, `columns[]` with `name`, `type`, optional `nullable`, optional `primaryKey`
- **Phase 2 (additive):** optional `sensitive` on a **table** or **column**. By default, NL→SQL DDL **lists** those identifiers with an `(sensitive)` tag; use CLI **`--omit-sensitive-from-prompt`** or env **`ASKDB_OMIT_SENSITIVE_FROM_PROMPT`** to withhold names (see [`docs/contracts/sensitive-fields-and-modes.md`](../../docs/contracts/sensitive-fields-and-modes.md)). Example: `fixtures/schemas/orders-users-sensitive.schema.json`.

Historical phase specs may still reference v1 because they document prior implementation milestones, not the current first-run path.
