import type { Connector } from "@askdb/introspect";
import type {
  AskDbConnectorConfig,
  AskDbConnectorProviderAdapter,
  AskDbConnectorResult,
} from "@askdb/connectors";
import { createPrismaConnector } from "./prisma.js";

export const prismaConnectorProvider: AskDbConnectorProviderAdapter = {
  provider: "prisma",
  createConnector(config: AskDbConnectorConfig): AskDbConnectorResult {
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
