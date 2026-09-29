import {
  hasUrlScheme,
  redactConnectionStringGeneric,
  redactUrlConnectionString,
} from "@askdb/connectors";

/**
 * Mask secrets in a MySQL connection string for display or logging.
 *
 * - URL form (what `mysql2` accepts) — `mysql://user:secret@host:3306/db?password=x`
 *   → `mysql://user:****@host:3306/db?password=****`. A password with an
 *   unencoded `/`, `?`, `#` or `@` is masked whole.
 * - Anything else (e.g. an ADO.NET-style `Server=h;Uid=u;Pwd=secret;`) goes
 *   through the generic `;`-separated redaction.
 *
 * The result is for humans only; never feed it back to a driver.
 */
export function redactConnectionString(input: string): string {
  if (hasUrlScheme(input)) {
    return redactUrlConnectionString(input, { separators: "&" });
  }
  return redactConnectionStringGeneric(input);
}
