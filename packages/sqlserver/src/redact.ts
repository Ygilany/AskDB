import {
  hasUrlScheme,
  redactSecretKeyValues,
  redactUrlConnectionString,
  redactUrlUserinfo,
} from "@askdb/connectors";

// Leading whitespace is allowed so " sqlserver://…;password=…" still takes the
// `;`-separated Prisma path instead of the `&`-separated URL path.
const PRISMA_SCHEME = /^\s*sqlserver:\/\//i;

/**
 * Mask secrets in a SQL Server connection string for display or logging.
 * Covers every format `resolveConnectionInput()` accepts:
 *
 * - `mssql://user:secret@host:1433/db` → `mssql://user:****@host:1433/db`
 *   (a password with an unencoded `/`, `?`, `#` or `@` is masked whole)
 * - Prisma/JDBC-style `sqlserver://host:1433;database=db;user=sa;password=secret`
 *   → `...;password=****` (`{braced}` values containing `;` are masked whole)
 * - ADO.NET `Server=host;User Id=sa;Password=secret;` / `Pwd=secret;`
 *   → `Password=****;` / `Pwd=****;` (quoted and `{braced}` values supported)
 *
 * The Prisma form has no URL userinfo: the part before the first `;` is
 * `host[:port]`, and everything after it is `key=value` pairs. So the text
 * after the first `;` is never read as userinfo — an `@` inside a password
 * there cannot turn the port's `:` into the start of a masked "password" and
 * leave the rest of the real one visible.
 *
 * `;` is the only pair separator in the `;`-delimited forms, so a password
 * containing `&` or spaces is masked whole. The result is for humans only;
 * never feed it back to a driver.
 */
export function redactConnectionString(input: string): string {
  if (PRISMA_SCHEME.test(input)) {
    const semi = input.indexOf(";");
    if (semi === -1) return redactUrlUserinfo(input);
    return (
      redactUrlUserinfo(input.slice(0, semi)) +
      redactSecretKeyValues(input.slice(semi), { separators: ";" })
    );
  }
  if (hasUrlScheme(input)) {
    return redactUrlConnectionString(input, { separators: "&" });
  }
  return redactSecretKeyValues(input, { separators: ";" });
}
