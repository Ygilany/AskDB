import type { Connector, IntrospectionResult } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
import { describeSqlServer } from "./describe.js";

/**
 * Connector input for `@askdb/sqlserver`: the kit's `LiveCatalogInput`, `{ mode: "live", runner,
 * filters?, schemaId? }`, so a field added there reaches this connector too (#816). `schemaId`
 * defaults to `"introspected"`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createSqlServerCatalogQueryRunner}).
 */
export type SqlServerIntrospectionInput = LiveCatalogInput;

export function createSqlServerConnector(): Connector<SqlServerIntrospectionInput> {
  return {
    async describe(input: SqlServerIntrospectionInput): Promise<IntrospectionResult> {
      return describeSqlServer(input);
    },
  };
}

export { describeSqlServer } from "./describe.js";
export type { DescribeSqlServerInput } from "./describe.js";
