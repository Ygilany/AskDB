import type { Connector } from "@askdb/introspect";
import type {
  AskDbConnectorConfig,
  AskDbConnectorProviderAdapter,
  AskDbConnectorResult,
} from "@askdb/connectors";
import { createMysqlConnector } from "./index.js";
import { createMysqlCatalogQueryRunner } from "../exec/mysql.js";

export const mysqlConnectorProvider: AskDbConnectorProviderAdapter = {
  provider: "mysql",
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult {
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
