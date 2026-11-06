# ADR 0037 — Introspection refuses to write an artifact with no tables

## Status

Accepted (2026-11-06), for #337. Implemented in PR #792.

## Context

Schema v2 requires at least one table: `loadSchema()` rejects a `schema.json` whose `tables` is empty (`packages/core/src/schema/v2/physical.ts`). Introspection disagreed. Given a source with nothing to render, it wrote `tables: []` and succeeded:

- **MySQL and SQLite** return `schemas: []` for a database with no tables or views.
- **Postgres** reports a schema with only enums or sequences as not empty, but the artifact describes only tables and views, so it renders none.
- **Any engine** with `--schemas`, `--exclude-schemas` or `--tables` filters that match nothing (`ambiguous_filter` is only a warning).

The user found out one command later, from a zod error that didn't mention introspection. Re-introspecting a database that had lost its tables replaced a valid artifact with the empty one, and logged nothing.

## Options considered

- **A. Introspection refuses to write an empty artifact (chosen).** It fails at the producer, while the user is still looking at the introspect command, and it protects an existing artifact from being overwritten.
- **B. The schema contract allows zero tables.** Rejected: an artifact with no tables can't answer a question, so every consumer (`ask()`, `@askdb/rag`, Studio, `@askdb/http-api`) would need its own behavior for one. That widens the contract and moves the failure later, for no gain.

## Decision

- **Where:** `renderSchemaV2Body()`, the one function every `schema.json` comes from (`renderToSchemaV2()`, `introspect()` with render options, and `askdb introspect --out`, `--print` and `--diff`). It throws when the rendered table list is empty. The check is the rendered `tables.length`, not the connector's `isEmpty`, so the Postgres enums-only case is covered.
- **What:** `EmptyIntrospectionError`, an `AskDbError` exported from `@askdb/introspect`, with `schemaId`, `provider` and `filters`. It throws before the merge with an existing artifact, so nothing is read or written past that point, and an existing `schema.json` and `tables/*.md` stay as they were.
- **The message** names the schema id, the engine (`provider`) and the filters, and lists the likely causes: no tables in the source, the wrong database or schema in the connection, filters that match nothing, or a user who can't read the catalog. It never repeats the connection.
- **The filters** reach the renderer through an optional `RenderOptions.filters`, which hosts already hold; the renderer reads them only for this message.
- **The hosts:** `askdb introspect` exits `1` with the message in every output mode. Studio answers `422` with it from introspection and resync.

## Consequences

- `askdb introspect` exits `1` where it exited `0` for an empty source. The beta.50 upgrade entry says so.
- Code that calls `introspect()` or the render functions on a source that may be empty catches `EmptyIntrospectionError`.
- The Schema v2 contract (`tables` has at least one entry) is unchanged.

## Related

- #337.
- `docs/contracts/schema-v2.md` and `packages/core/src/schema/v2/physical.ts`, the contract this keeps.
