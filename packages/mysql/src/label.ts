import { formatConnectionLabel, parseConnectionUrl } from "@askdb/connectors";

/**
 * A credential-free label for a MySQL connection string, for display or logs:
 * `mysql://host:port/database`, built only from the parts of a `mysql://` URL
 * (the form `mysql2` accepts) that parse cleanly. The user name, password and
 * query string are never included. Anything else — a JDBC URL, a quoted or
 * malformed URL — becomes `configured mysql connection`.
 */
export function connectionLabel(input: string): string {
  return formatConnectionLabel("mysql", parseConnectionUrl(input, ["mysql"]));
}
