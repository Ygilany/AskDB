import type { Connector, IntrospectionResult } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
import { describeMysql } from "./describe.js";

/**
 * Connector input for `@askdb/mysql`: the kit's `LiveCatalogInput`, `{ mode: "live", runner,
 * filters?, schemaId? }`, so a field added there reaches this connector too (#816). `schemaId`
 * defaults to `"introspected"`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createMysqlCatalogQueryRunner}).
 * From-export bundle mode (à la `@askdb/postgres`) is not implemented here yet.
 */
export type MysqlIntrospectionInput = LiveCatalogInput;

export function createMysqlConnector(): Connector<MysqlIntrospectionInput> {
  return {
    async describe(input: MysqlIntrospectionInput): Promise<IntrospectionResult> {
      return describeMysql(input);
    },
  };
}

export { describeMysql } from "./describe.js";
export type { DescribeMysqlInput } from "./describe.js";
