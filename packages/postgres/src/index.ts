/**
 * `@askdb/postgres` — Postgres integration for AskDB.
 *
 * Bundles three pieces:
 *   1. **Dialect re-export** — `postgresDialect` re-exports `POSTGRES_DIALECT`
 *      from `@askdb/core` so existing callers continue to work. The NL→SQL
 *      pipeline (prompt, generate, validate) lives in `@askdb/core` and is
 *      parameterized by `DialectSpec`.
 *   2. **Connector** — `createPostgresConnector()` for `@askdb/introspect`.
 *   3. **Catalog query runner** — `createPostgresCatalogQueryRunner()` for live
 *      introspection via `pg`.
 *   4. **Templates** — `POSTGRES_TEMPLATE_BUNDLE` (catalog SQL suite for live + from-export modes).
 */

export {
  POSTGRES_DIALECT,
  // Compatibility alias for existing callers. Prefer `dialect: "postgres"` or
  // `POSTGRES_DIALECT` directly from `@askdb/core` in new code.
  POSTGRES_DIALECT as postgresDialect,
  type DialectSpec as PostgresDialect,
} from "@askdb/core";

export {
  createPostgresConnector,
  describePostgres,
  describePostgresFromExport,
  POSTGRES_TEMPLATE_BUNDLE,
  POSTGRES_TEMPLATE_VERSION,
  POSTGRES_TEMPLATES,
  type DescribePostgresInput,
  type DescribePostgresExportInput,
  type PostgresIntrospectionInput,
  type PostgresSqlTemplateName,
} from "./connector/index.js";

export {
  createPostgresCatalogQueryRunner,
  type CatalogQueryResult,
  type CatalogQueryRunner,
} from "./exec/postgres.js";
