import type {
  CatalogQueryRunner,
  Connector,
  IntrospectionFilters,
  IntrospectionResult,
} from "@askdb/introspect";
import { describeSqlite } from "./describe.js";

/**
 * Connector input for `@askdb/sqlite`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createSqliteCatalogQueryRunner}).
 */
export type SqliteIntrospectionInput = {
  mode: "live";
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
};

export function createSqliteConnector(): Connector<SqliteIntrospectionInput> {
  return {
    async describe(input: SqliteIntrospectionInput): Promise<IntrospectionResult> {
      return describeSqlite({ runner: input.runner, filters: input.filters });
    },
  };
}

export { describeSqlite, SQLITE_CATALOG_SQL } from "./describe.js";
export type { DescribeSqliteInput } from "./describe.js";
