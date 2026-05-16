/**
 * `@askdb/sqlserver` — Microsoft SQL Server (T-SQL) integration for AskDB.
 *
 * Pairs with `SQLSERVER_DIALECT` from `@askdb/core`. This package ships only
 * the introspection connector and the `mssql`-backed catalog runner; the
 * NL→SQL prompt + validator live in `@askdb/core`.
 */

export {
  SQLSERVER_DIALECT,
  type DialectSpec as SqlServerDialect,
} from "@askdb/core";

export {
  createSqlServerConnector,
  describeSqlServer,
  SQLSERVER_CATALOG_SQL,
  type DescribeSqlServerInput,
  type SqlServerIntrospectionInput,
} from "./connector/index.js";

export {
  createSqlServerCatalogQueryRunner,
  type CatalogQueryResult,
  type CatalogQueryRunner,
} from "./exec/sqlserver.js";
