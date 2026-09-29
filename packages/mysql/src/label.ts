import type { ConnectionLabelParts } from "@askdb/connectors";

/**
 * The display-safe parts of a MySQL connection string, read the way `mysql2`
 * reads it: `ConnectionConfig.parseUrl` is WHATWG `new URL(url)` with
 * `host = decodeURIComponent(hostname)`, `port = port`, and
 * `database = decodeURIComponent(pathname.slice(1))`. `mysql2` itself isn't a
 * dependency here (it is ~630 KB with seven dependencies, and an optional
 * peer), so this uses the same built-in parser and mapping; a differential test
 * checks it against `mysql2`'s own `parseUrl` (ADR 0011).
 *
 * Returns `undefined` (the registry labels it `configured mysql connection`)
 * when `new URL` throws, when the scheme isn't `mysql:`, or when an `@` or `#`
 * sits after the host: a password containing `/`, `?` or `#` is split there.
 * `formatConnectionLabel`'s allowlist is the second check.
 */
export function parseMysqlConnection(input: string): ConnectionLabelParts | undefined {
  let url: URL;
  let host: string;
  let database: string;
  try {
    url = new URL(input);
    host = decodeURIComponent(url.hostname);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return undefined;
  }
  if (url.protocol !== "mysql:") return undefined;
  if (url.hash !== "" || `${url.pathname}${url.search}`.includes("@")) return undefined;
  return {
    ...(host !== "" ? { host } : {}),
    ...(url.port !== "" ? { port: url.port } : {}),
    ...(database !== "" ? { database } : {}),
  };
}
