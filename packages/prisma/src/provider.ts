import type { Connector, IntrospectionFilters } from "@askdb/introspect";
import { createPrismaConnector } from "./prisma.js";

export const prismaConnectorProvider = {
  provider: "prisma" as const,
  createConnector(config: {
    schemaPath?: string;
    filters?: IntrospectionFilters;
    schemaId?: string;
  }): { connector: Connector<unknown>; input: unknown; mode: string } {
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
