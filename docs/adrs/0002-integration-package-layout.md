# ADR 0002 — Integration-package layout

Status: Accepted (2026-05-10).
Supersedes (in part): Phase 4 decision to ship `createPostgresExecutor` from a `@askdb/core/postgres` subpath (`docs/specs/phase-4-publish-npm/requirements.md`, "Postgres helper packaging").

## Context

Phase 4 packaged the built-in `pg`-backed executor inside `@askdb/core` under a separate `@askdb/core/postgres` subpath. The intent was to let consumers who only used a custom executor avoid the `pg` peer dependency, while keeping all first-party Postgres code in one place.

By Phase 6 (introspection) and Phase 7 (TUI enrichment), Postgres had spread into both `@askdb/core` and `@askdb/introspect`:

- `@askdb/core` owned `validatePostgresSelectSql`, `generatePostgresSelectSql`, NL→SQL prompt strings, the `pg`-backed executor, and a `connectionString` shortcut on `ask()`.
- `@askdb/introspect` shipped a built-in Postgres connector at `src/postgres/` plus a Postgres-shaped `IntrospectionInput` discriminated union.

Forward-looking integrations make this layout untenable:

- **MySQL** would need its own templates, row shapes, and dialect rules, but the catalog-driven shape fits `IntrospectionInput`.
- **Prisma** has no live executor and no catalog templates — its input is a `schema.prisma` file. Forcing it into `IntrospectionInput`'s `live | from-export` union is a square peg.

## Decision

Reorganize AskDB around **one package per integration surface**, not per database engine and not per layer.

- `@askdb/core` is dialect-agnostic. It defines the `ask()` pipeline, the executor port (`AskDbExecutor`), the schema/IR types, modes, and logging. It does not import `pg`, does not know what SQL dialect is being generated, and does not construct executors.
- `@askdb/introspect` is engine-agnostic. It defines the `Connector<TInput>` interface (generic over the integration's input shape), the orchestrator, and the Schema v2 renderer. It does not ship a default connector and does not declare what live vs. from-export means.
- Integration packages (`@askdb/postgres`, future `@askdb/mysql`, `@askdb/prisma`, ...) own their dialect, their connector, their input shape, their executor adapters, and any engine-specific helpers (e.g. SQL templates, bundle readers).

Concretely:

1. The `@askdb/core/postgres` subpath is removed. `createPostgresExecutor` now lives in `@askdb/postgres`.
2. `ask()` accepts a required `dialect` adapter (`AskDialect`). `@askdb/postgres` exports `postgresDialect`. The `connectionString` shortcut on `ask()` is removed; callers construct the executor themselves and pass it via `executor`.
3. `@askdb/introspect`'s `IntrospectionInput` discriminated union is removed from the public API. `@askdb/postgres` exports `PostgresIntrospectionInput`. Future integrations export their own input types.
4. `Connector` becomes generic over `TInput`; `templates()` is optional (Prisma legitimately does not have one).
5. The standalone `askdb-introspect` binary retires. Introspection is reached via `askdb introspect` (an `@askdb/cli` subcommand).

## Rationale

- **Prisma's input is not the same kind of thing as Postgres's.** A discriminated `live | from-export` union baked into the core contract forces every future integration to pretend it fits that model. Connector-owned input shapes keep each integration's seam honest.
- **Dialect is integration-package knowledge.** Validating that a string starts with `SELECT` is universal; the actual forbidden-keyword list, the prompt wording, and the catalog query strings are not.
- **Apps are not libraries.** `cli`, `http-api`, `tui`, and `docs-site` are first-party reference apps, not extension points. They live under `apps/` to make that boundary explicit. The supported user-facing product surface is `@askdb/cli`, batteries-included Prisma-style.
- **Driver split is a future refactor, not pre-extracted today.** `@askdb/postgres` bundles dialect + connector + bundle reader + `pg` executor. When a second driver (`postgres.js`, Neon HTTP) lands, splitting executor packages off will be a deliberate breaking change. Pre-extracting now would optimize for a problem we don't have.

## Consequences

- Breaking changes for pre-1.0 consumers: import paths, `ask()` signature, executor construction, introspection wiring. No migrator ships — pre-1.0 makes this acceptable. The changeset records the break.
- Adding a new integration (`@askdb/mysql`, `@askdb/prisma`) is a self-contained package addition. No core or introspect changes required as long as the contracts stay stable.
- The Postgres dialect remains the only one shipping in this PR. A second dialect would prove out the contract; until then we treat the dialect adapter shape as provisional and stable enough for one user.

## Out of scope

- Multi-driver Postgres support (`postgres.js`, Neon HTTP) — deliberately deferred.
- Plugin-style dialect/connector registries — the adapter object passed to `ask()` and the connector passed to `introspect()` is the registration mechanism for now.
- Migration tooling from old to new layout — none ships; pre-1.0 break.

## Related

- Phase 4: `docs/specs/phase-4-publish-npm/requirements.md` (Postgres helper packaging — partially superseded).
- Phase 6: `docs/specs/phase-6-introspection/requirements.md` (per-engine connector pattern — generalized).
- Roadmap: "Phase 7.5 — Architecture reshape for integration packages."
