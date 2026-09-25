import {
  hasUrlScheme,
  redactSecretKeyValues,
  redactUrlUserinfo,
} from "@askdb/connectors";

/**
 * Mask secrets in a Postgres connection string for display or logging.
 *
 * - URL form — `postgres://user:secret@host:5432/db?sslpassword=x` →
 *   `postgres://user:****@host:5432/db?sslpassword=****` (userinfo password
 *   and secret query params such as `password`, `sslpassword`).
 * - libpq keyword/value form — `host=h user=u password='se cret' dbname=d` →
 *   `host=h user=u password=**** dbname=d` (whitespace-separated, quote aware).
 *
 * The result is for humans only; never feed it back to a driver.
 */
export function redactConnectionString(input: string): string {
  if (hasUrlScheme(input)) {
    return redactSecretKeyValues(redactUrlUserinfo(input), { separators: "&" });
  }
  return redactSecretKeyValues(input, { separators: "", whitespaceSeparated: true });
}
