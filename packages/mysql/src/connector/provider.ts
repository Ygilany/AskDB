import { defineLiveConnectorProvider } from "@askdb/introspect/kit";
import { createMysqlConnector } from "./index.js";
import { createMysqlCatalogQueryRunner } from "../exec/mysql.js";
import { redactConnectionString } from "../redact.js";

export const mysqlConnectorProvider = defineLiveConnectorProvider({
  provider: "mysql",
  displayName: "MySQL",
  runtimeKey: "mysqlDatabaseUrl",
  connectionNoun: "a connection URL",
  missingConnection: {
    cli: "Provide --url <mysql-url> (or set introspection.providerConfig.mysql.databaseUrl / ASKDB_INTROSPECT_MYSQL_URL / DATABASE_URL).",
    config:
      "No MySQL connection configured. Set introspection.providerConfig.mysql.databaseUrl in askdb.config.ts (bound to an env var in .env).",
  },
  createConnector: createMysqlConnector,
  createRunner: (url) => createMysqlCatalogQueryRunner(url),
  redactConnectionString,
});
