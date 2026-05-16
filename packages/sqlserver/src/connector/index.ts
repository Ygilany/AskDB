import type {
  CatalogQueryRunner,
  Connector,
  IntrospectionFilters,
  IntrospectionResult,
} from "@askdb/introspect";
import { describeSqlServer } from "./describe.js";

/**
 * Connector input for `@askdb/sqlserver`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createSqlServerCatalogQueryRunner}).
 */
export type SqlServerIntrospectionInput = {
  mode: "live";
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
};

export function createSqlServerConnector(): Connector<SqlServerIntrospectionInput> {
  return {
    async describe(input: SqlServerIntrospectionInput): Promise<IntrospectionResult> {
      return describeSqlServer({ runner: input.runner, filters: input.filters });
    },
  };
}

export { describeSqlServer, SQLSERVER_CATALOG_SQL } from "./describe.js";
export type { DescribeSqlServerInput } from "./describe.js";
