/**
 * `@askdb/mysql` — MySQL/MariaDB integration for AskDB.
 *
 * Pairs with `MYSQL_DIALECT` (or `MARIADB_DIALECT`) from `@askdb/core`. This
 * package ships only the introspection connector and the `mysql2`-backed
 * catalog runner; the NL→SQL prompt + validator live in `@askdb/core`.
 */

export {
  MYSQL_DIALECT,
  MARIADB_DIALECT,
  type DialectSpec as MysqlDialect,
} from "@askdb/core";

export {
  createMysqlConnector,
  describeMysql,
  MYSQL_CATALOG_SQL,
  type DescribeMysqlInput,
  type MysqlIntrospectionInput,
} from "./connector/index.js";

export {
  createMysqlCatalogQueryRunner,
  type CatalogQueryResult,
  type CatalogQueryRunner,
} from "./exec/mysql.js";
