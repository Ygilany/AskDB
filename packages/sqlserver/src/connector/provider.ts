import type { Connector } from "@askdb/introspect";
import type { AskDbConnectorConfig, AskDbConnectorProviderAdapter, AskDbConnectorResult } from "@askdb/connectors";
import { createSqlServerConnector } from "./index.js";
import { createSqlServerCatalogQueryRunner } from "../exec/sqlserver.js";

export const sqlServerConnectorProvider: AskDbConnectorProviderAdapter = {
  provider: "sqlserver",
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult {
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
