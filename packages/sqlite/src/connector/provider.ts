import { defineLiveConnectorProvider } from "@askdb/introspect/kit";
import { createSqliteConnector } from "./index.js";
import { createSqliteCatalogQueryRunner } from "../exec/sqlite.js";
import { redactConnectionString } from "../redact.js";

/**
 * The configured file path is passed to `better-sqlite3` unchanged, so a
 * relative path resolves against the process cwd — the project root for the
 * `askdb` CLI and Studio, which discover `askdb.config.*` in the cwd.
 */
export const sqliteConnectorProvider = defineLiveConnectorProvider({
  provider: "sqlite",
  displayName: "SQLite",
  runtimeKey: "sqliteFile",
  connectionNoun: "a file path",
  missingConnection: {
    cli: "Provide --url <path-to-sqlite-file> (or set introspection.providerConfig.sqlite.file / ASKDB_INTROSPECT_SQLITE_FILE).",
    config: "No SQLite file configured. Set introspection.providerConfig.sqlite.file in askdb.config.ts.",
  },
  createConnector: createSqliteConnector,
  createRunner: (file) => createSqliteCatalogQueryRunner(file),
  redactConnectionString,
});
