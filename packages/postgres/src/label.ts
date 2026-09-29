import { parseConnectionUrl, type ConnectionLabelParts } from "@askdb/connectors";

/**
 * The display-safe parts of a Postgres connection string: host, port and
 * database of a `postgres://` / `postgresql://` URL that parses cleanly. The
 * user name, password and query string are never returned. Anything else — a
 * libpq `key=value` string, a JDBC URL, a quoted or malformed URL — returns
 * `undefined`, so the registry labels it `configured postgres connection`.
 */
export function parsePostgresConnection(input: string): ConnectionLabelParts | undefined {
  return parseConnectionUrl(input, ["postgres", "postgresql"]);
}
