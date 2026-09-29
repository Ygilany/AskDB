/**
 * `@askdb/sqlite` — SQLite integration for AskDB.
 *
 * Pairs with `SQLITE_DIALECT` from `@askdb/core`. This package ships only the
 * introspection connector and the `better-sqlite3`-backed catalog runner; the
 * NL→SQL prompt + validator live in `@askdb/core`.
 */

export {
  SQLITE_DIALECT,
  type DialectSpec as SqliteDialect,
} from "@askdb/core";

export {
  createSqliteConnector,
  describeSqlite,
  SQLITE_CATALOG_SQL,
  type DescribeSqliteInput,
  type SqliteIntrospectionInput,
} from "./connector/index.js";

export {
  createSqliteCatalogQueryRunner,
  loadBetterSqlite3Driver,
  isBetterSqlite3DriverInstalled,
  type Bs3Namespace,
  type CatalogQueryResult,
  type CatalogQueryRunner,
} from "./exec/sqlite.js";

export { sqliteConnectorProvider } from "./connector/provider.js";
