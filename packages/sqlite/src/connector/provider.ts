import type { Connector } from "@askdb/introspect";
import type { ConnectorConfig, ConnectorProviderAdapter, ConnectorResult } from "@askdb/connectors";
import { createSqliteConnector } from "./index.js";
import { createSqliteCatalogQueryRunner } from "../exec/sqlite.js";

export const sqliteConnectorProvider: ConnectorProviderAdapter = {
  provider: "sqlite",
  createConnector(config: ConnectorConfig): ConnectorResult {
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
