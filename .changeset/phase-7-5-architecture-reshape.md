---
"@askdb/core": minor
"@askdb/introspect": minor
"@askdb/postgres": minor
"@askdb/cli": minor
"@askdb/http-api": minor
"@askdb/tui": patch
---

Reshape AskDB around one package per integration surface (Phase 7.5).

**Pre-1.0 breaking — `@askdb/core`**

- `ask()` now requires a `dialect: AskDialect` adapter. Pass `postgresDialect` from `@askdb/postgres` to keep the previous behavior.
- The `connectionString`, `execute`, and `executor` options are removed from `ask()`. AskDB now returns generated SQL only.
- The `@askdb/core/postgres` subpath is removed. Postgres-specific dialect, validation, generation, and introspection helpers move to `@askdb/postgres`.
- The dialect-specific helpers `validatePostgresSelectSql`, `generatePostgresSelectSql`, `buildPostgresSelectGuardrailExplanation`, `buildNlToSqlUserPrompt`, `nlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` move to `@askdb/postgres`.
- `AnyNormalizedSchema` is now exported from `@askdb/core` (it previously came in via the prompt module).
- `pg` is no longer a peer dependency of `@askdb/core`.

**Pre-1.0 breaking — `@askdb/introspect`**

- The public `IntrospectionInput` discriminated union is removed. Each integration package owns its own input shape (e.g. `PostgresIntrospectionInput` from `@askdb/postgres`).
- The `Connector` interface is now `Connector<TInput>`, generic over the integration's input. `templates()` is optional. The `engine: "postgres"` literal is gone.
- `SqlTemplateName` and the Postgres-specific template name union are removed from the public surface. `SqlTemplate.name` is now `string`; `SqlTemplateBundle.engine` is now `string`.
- `introspect()` no longer has a default connector. Callers must supply one via `options.connector` (e.g. `createPostgresConnector()`).
- The `askdb-introspect` standalone binary and the `@askdb/introspect/cli` and `@askdb/introspect/postgres` subpaths are removed. Use `askdb introspect` from `@askdb/cli`, and import the connector from `@askdb/postgres`.

**New — `@askdb/postgres`**

- New package bundling the Postgres dialect (`postgresDialect`, `generatePostgresSelectSql`, `validatePostgresSelectSql`), the connector (`createPostgresConnector`, live + from-export), the catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`), the bundle reader, and the `pg`-backed catalog runner (`createPostgresCatalogQueryRunner`).
- `pg` is an optional peer dependency, lazy-loaded only when live catalog introspection is invoked.

**Pre-1.0 breaking — apps**

- `@askdb/cli` now wires `postgresDialect` internally. The `askdb introspect` subcommand replaces the retired `askdb-introspect` binary.
- `@askdb/http-api` no longer accepts execution controls or `connectionString` in request bodies. It returns generated SQL only.
- `apps/{cli,http-api,tui,docs-site}` moved from `packages/*` to `apps/*`. Repository `directory` metadata updated accordingly.
