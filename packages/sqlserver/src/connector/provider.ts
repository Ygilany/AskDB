import type { Connector, IntrospectionFilters } from "@askdb/introspect";
import { createSqlServerConnector } from "./index.js";
import { createSqlServerCatalogQueryRunner } from "../exec/sqlserver.js";

export const sqlServerConnectorProvider = {
  provider: "sqlserver" as const,
  createConnector(config: {
    url?: string;
    filters?: IntrospectionFilters;
  }): { connector: Connector<unknown>; input: unknown; mode: string } {
    if (!config.url) {
      throw new Error("SQL Server connector requires a connection URL (config.url).");
    }
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createSqlServerCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createSqlServerConnector() as Connector<unknown>,
    };
  },
};
