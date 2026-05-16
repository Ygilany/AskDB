import type {
  CatalogQueryRunner,
  Connector,
  IntrospectionFilters,
  IntrospectionResult,
} from "@askdb/introspect";
import { describeMysql } from "./describe.js";

/**
 * Connector input for `@askdb/mysql`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createMysqlCatalogQueryRunner}).
 * From-export bundle mode (à la `@askdb/postgres`) is not implemented here yet.
 */
export type MysqlIntrospectionInput = {
  mode: "live";
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
};

export function createMysqlConnector(): Connector<MysqlIntrospectionInput> {
  return {
    async describe(input: MysqlIntrospectionInput): Promise<IntrospectionResult> {
      return describeMysql({ runner: input.runner, filters: input.filters });
    },
  };
}

export { describeMysql, MYSQL_CATALOG_SQL } from "./describe.js";
export type { DescribeMysqlInput } from "./describe.js";
