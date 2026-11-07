import type { Connector, IntrospectionResult } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
import { describeSqlite } from "./describe.js";

/**
 * Connector input for `@askdb/sqlite`: the kit's `LiveCatalogInput`, `{ mode: "live", runner,
 * filters?, schemaId? }`, so a field added there reaches this connector too (#816). `schemaId`
 * defaults to `"introspected"`. Live introspection only — supply a
 * `CatalogQueryRunner` (e.g. from {@link createSqliteCatalogQueryRunner}).
 */
export type SqliteIntrospectionInput = LiveCatalogInput;

export function createSqliteConnector(): Connector<SqliteIntrospectionInput> {
  return {
    async describe(input: SqliteIntrospectionInput): Promise<IntrospectionResult> {
      return describeSqlite(input);
    },
  };
}

export { describeSqlite } from "./describe.js";
export type { DescribeSqliteInput } from "./describe.js";
