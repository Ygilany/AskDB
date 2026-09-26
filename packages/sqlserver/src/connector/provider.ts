import { defineLiveConnectorProvider } from "@askdb/introspect/kit";
import { createSqlServerConnector } from "./index.js";
import { createSqlServerCatalogQueryRunner } from "../exec/sqlserver.js";
import { redactConnectionString } from "../redact.js";

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
  createConnector: createSqlServerConnector,
  createRunner: (url) => createSqlServerCatalogQueryRunner(url),
  redactConnectionString,
});
