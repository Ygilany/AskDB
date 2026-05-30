import type { Connector, IntrospectionFilters } from "@askdb/introspect";
import { createMysqlConnector } from "./index.js";
import { createMysqlCatalogQueryRunner } from "../exec/mysql.js";

export const mysqlConnectorProvider = {
  provider: "mysql" as const,
  createConnector(config: {
    url?: string;
    filters?: IntrospectionFilters;
  }): { connector: Connector<unknown>; input: unknown; mode: string } {
    if (!config.url) {
      throw new Error("MySQL connector requires a connection URL (config.url).");
    }
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createMysqlCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createMysqlConnector() as Connector<unknown>,
    };
  },
};
