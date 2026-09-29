import { parseConnectionUrl, type ConnectionLabelParts } from "@askdb/connectors";

/**
 * The display-safe parts of a MySQL connection string: host, port and database
 * of a `mysql://` URL (the form `mysql2` accepts) that parses cleanly. The user
 * name, password and query string are never returned. Anything else — a JDBC
 * URL, a quoted or malformed URL — returns `undefined`, so the registry labels
 * it `configured mysql connection`.
 */
export function parseMysqlConnection(input: string): ConnectionLabelParts | undefined {
  return parseConnectionUrl(input, ["mysql"]);
}
