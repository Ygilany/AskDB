import { defineLiveConnectorProvider } from "@askdb/introspect/kit";
import { createSqlServerConnector } from "./index.js";
import { createSqlServerCatalogQueryRunner } from "../exec/sqlserver.js";
import { parseSqlServerConnection } from "../label.js";

export const sqlServerConnectorProvider = defineLiveConnectorProvider({
  provider: "sqlserver",
  displayName: "SQL Server",
  runtimeKey: "sqlserverDatabaseUrl",
  connectionNoun: "a connection URL",
  missingConnection: {
    cli: "Provide --url <sqlserver-url> (or set introspection.providerConfig.sqlserver.databaseUrl / ASKDB_INTROSPECT_SQLSERVER_URL / DATABASE_URL).",
    config:
      "No SQL Server connection configured. Set introspection.providerConfig.sqlserver.databaseUrl in askdb.config.ts (bound to an env var in .env).",
  },
  fromExportUnsupported: "--from-export is currently supported only for --engine postgres (got sqlserver).",
  createConnector: createSqlServerConnector,
  createRunner: (url) => createSqlServerCatalogQueryRunner(url),
  connectionLabelParts: parseSqlServerConnection,
});
