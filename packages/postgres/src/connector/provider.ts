import type { Connector, IntrospectionFilters, SqlTemplateBundle } from "@askdb/introspect";
import { createPostgresConnector } from "./index.js";
import { createPostgresCatalogQueryRunner } from "../exec/postgres.js";

export const postgresConnectorProvider = {
  provider: "postgres" as const,
  createConnector(config: {
    url?: string;
    fromExport?: string;
    filters?: IntrospectionFilters;
  }): { connector: Connector<unknown>; input: unknown; mode: string } {
    if (config.fromExport) {
      return {
        mode: "from-export",
        input: { mode: "from-export", bundlePath: config.fromExport, filters: config.filters },
        connector: createPostgresConnector() as Connector<unknown>,
      };
    }
    if (!config.url) {
      throw new Error(
        "Postgres connector requires a connection URL (config.url) or an export bundle path (config.fromExport).",
      );
    }
    return {
      mode: "live",
      input: {
        mode: "live",
        runner: createPostgresCatalogQueryRunner(config.url),
        filters: config.filters,
      },
      connector: createPostgresConnector() as Connector<unknown>,
    };
  },
  getTemplates(): SqlTemplateBundle {
    return createPostgresConnector().templates!();
  },
};
