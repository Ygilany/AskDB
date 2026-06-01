import type { Connector } from "@askdb/introspect";
import type { ConnectorConfig, ConnectorProviderAdapter, ConnectorResult } from "@askdb/connectors";
import { createPrismaConnector } from "./prisma.js";

export const prismaConnectorProvider: ConnectorProviderAdapter = {
  provider: "prisma",
  createConnector(config: ConnectorConfig): ConnectorResult {
    return {
      mode: "prisma-schema",
      input: {
        schemaPath: config.schemaPath,
        schemaId: config.schemaId,
        filters: config.filters,
      },
      connector: createPrismaConnector() as Connector<unknown>,
    };
  },
};
