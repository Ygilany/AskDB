# `@askdb/introspect` test fixtures

Pinned catalog snapshots used by `@askdb/introspect` unit tests. Each file is
the row payload the Postgres template suite would return when run against
the corresponding database — captured into JSON so the connector can be
exercised without a live `pg` connection.

The shape of each file mirrors `SqlTemplateBundle.templates`: keys are
template names (`schemas`, `tables`, `columns`, `primary_keys`,
`foreign_keys`, `unique_constraints`, `check_constraints`, `indexes`,
`enums`, `sequences`, `views`, `comments`); each value is a list of records
whose keys match the template's `columns` declaration.

## Files

| File | Purpose |
| ---- | ------- |
| `orders-users.catalog.json` | Hand-curated rows for the Phase 5 hand-authored fixture (`fixtures/schemas/orders-users.schema/`). Drives the M3 renderer golden test — the connector + renderer together must reproduce the v2 artifact byte-identically. |
| `multi-column-fk.catalog.json` | Regression guard for the documented Drizzle multi-column FK ordering bug. A composite-PK + composite-FK schema where the FK columns must come back in declared `pg_constraint.conkey` order. |
| `enum-sort-order.catalog.json` | Regression guard for `pg_enum.enumsortorder`. Enum values must come back in declared sort order, not alphabetical. |

These fixtures should change rarely. When the canonical SQL or row shapes
change, update both the templates (under `packages/introspect/src/postgres/`)
and these fixtures together.
