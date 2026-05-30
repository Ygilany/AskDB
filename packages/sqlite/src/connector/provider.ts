import type { Connector } from "@askdb/introspect";
import type {
  AskDbConnectorConfig,
  AskDbConnectorProviderAdapter,
  AskDbConnectorResult,
} from "@askdb/connectors";
import { createSqliteConnector } from "./index.js";
import { createSqliteCatalogQueryRunner } from "../exec/sqlite.js";

export const sqliteConnectorProvider: AskDbConnectorProviderAdapter = {
  provider: "sqlite",
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult {
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
