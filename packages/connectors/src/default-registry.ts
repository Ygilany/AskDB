import { createAskDbConnectorRegistry } from "./registry.js";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

/**
 * Pre-built registry containing all first-party connector providers.
 * Suitable for the CLI and other batteries-included applications that support
 * all engines without asking the caller to wire individual adapters.
 *
 * Library users who want a narrower registry (e.g. only postgres) should call
 * `createAskDbConnectorRegistry` with the specific adapters they need.
 */
export const connectorRegistry = createAskDbConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);
