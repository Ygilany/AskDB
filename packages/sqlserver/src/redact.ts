import {
  hasUrlScheme,
  redactSecretKeyValues,
  redactUrlUserinfo,
} from "@askdb/introspect/kit";

/**
 * Mask secrets in a SQL Server connection string for display or logging.
 * Covers every format `resolveConnectionInput()` accepts:
 *
 * - `mssql://user:secret@host:1433/db` → `mssql://user:****@host:1433/db`
 * - Prisma/JDBC-style `sqlserver://host:1433;database=db;user=sa;password=secret`
 *   → `...;password=****` (`{braced}` values containing `;` are masked whole)
 * - ADO.NET `Server=host;User Id=sa;Password=secret;` / `Pwd=secret;`
 *   → `Password=****;` / `Pwd=****;` (quoted and `{braced}` values supported)
 *
 * `;` is the only pair separator in the `;`-delimited forms, so a password
 * containing `&` or spaces is masked whole. The result is for humans only;
 * never feed it back to a driver.
 */
export function redactConnectionString(input: string): string {
  if (hasUrlScheme(input)) {
    const withoutUserinfo = redactUrlUserinfo(input);
    // `sqlserver://host;key=value;...` (JDBC/Prisma) vs `mssql://...?key=value&...`.
    const separators = input.includes(";") ? ";" : "&";
    return redactSecretKeyValues(withoutUserinfo, { separators });
  }
  return redactSecretKeyValues(input, { separators: ";" });
}
