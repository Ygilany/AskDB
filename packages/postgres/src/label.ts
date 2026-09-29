import { formatConnectionLabel, parseConnectionUrl } from "@askdb/connectors";

/**
 * A credential-free label for a Postgres connection string, for display or
 * logs: `postgres://host:port/database`, built only from the parts of a
 * `postgres://` / `postgresql://` URL that parse cleanly. The user name,
 * password and query string are never included. Anything else — a libpq
 * `key=value` string, a JDBC URL, a quoted or malformed URL — becomes
 * `configured postgres connection`.
 */
export function connectionLabel(input: string): string {
  return formatConnectionLabel("postgres", parseConnectionUrl(input, ["postgres", "postgresql"]));
}
