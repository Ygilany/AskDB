import type { Connector, IntrospectionFilters } from "@askdb/introspect";
import { createSqliteConnector } from "./index.js";
import { createSqliteCatalogQueryRunner } from "../exec/sqlite.js";

export const sqliteConnectorProvider = {
  provider: "sqlite" as const,
  createConnector(config: {
    url?: string;
    filters?: IntrospectionFilters;
  }): { connector: Connector<unknown>; input: unknown; mode: string } {
    if (!config.url) {
      throw new Error("SQLite connector requires a file path (config.url).");
    }
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createSqliteCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createSqliteConnector() as Connector<unknown>,
    };
  },
};
