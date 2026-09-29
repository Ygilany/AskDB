import { REDACTED_SECRET, isSecretConnectionKey } from "@askdb/connectors";

/** SQLCipher / SEE encryption-key URI parameters (`key`, `hexkey`, `textkey`). */
const ENCRYPTION_KEY_PARAM = /^(?:hex|text)?key$/i;

/**
 * Mask secrets in a SQLite "connection string" for display or logging.
 *
 * A plain file path (or `:memory:`) carries no credentials and is returned
 * unchanged. A `file:` URI can carry secrets in its query string, such as an
 * encryption `key=` / `hexkey=` / `textkey=` or a `password=`; those values are
 * masked (`file:app.db?mode=ro&key=****`). If a masked value is followed by a
 * segment that isn't `key=value` (an unescaped `&` inside the secret), the
 * rest of the string is masked too. The result is for humans only; never feed
 * it back to a driver.
 */
export function redactConnectionString(input: string): string {
  const q = input.indexOf("?");
  if (q === -1) return input;
  const params = input.slice(q + 1).split("&");
  const out: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const eq = param.indexOf("=");
    const key = eq === -1 ? "" : param.slice(0, eq).trim();
    if (eq === -1 || !(isSecretConnectionKey(key) || ENCRYPTION_KEY_PARAM.test(key))) {
      out.push(param);
      continue;
    }
    out.push(`${param.slice(0, eq + 1)}${REDACTED_SECRET}`);
    const next = params.slice(i + 1).find((p) => p.trim() !== "");
    if (next !== undefined && !next.includes("=")) break;
  }
  return `${input.slice(0, q + 1)}${out.join("&")}`;
}
