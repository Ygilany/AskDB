import {
  runtimeIntrospectionString,
  type Connector,
  type ConnectorConfig,
  type ConnectorProviderAdapter,
  type ConnectorResult,
} from "@askdb/introspect";
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
  /**
   * An explicit schema path wins; otherwise use the configured
   * `introspection.providerConfig.prisma.schemaPath`. When neither is set the
   * connector auto-discovers `prisma/schema.prisma` or `schema.prisma` in the cwd.
   */
  resolveConnection({ explicit = {}, runtime }) {
    const schemaPath = explicit.schemaPath ?? runtimeIntrospectionString(runtime, "prismaSchemaPath");
    if (explicit.url || explicit.fromExport) {
      return { ok: false, error: "Use --prisma-schema with --engine prisma, not --url or --from-export." };
    }
    return {
      ok: true,
      connection: { schemaPath },
      sourceLabel: schemaPath ?? "auto-discovered prisma/schema.prisma",
    };
  },
};
