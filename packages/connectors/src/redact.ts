/**
 * Connection-string redaction building blocks shared by the engine packages'
 * `redactConnectionString()` exports (and usable directly as a generic
 * fallback). Output is for display/logging only — it is never meant to be
 * parsed back into a working connection string.
 *
 * Safety over fidelity: when a string is ambiguous, these helpers mask more
 * than strictly necessary rather than risk echoing a secret.
 */

/** Placeholder written in place of any redacted secret. */
export const REDACTED_SECRET = "****";

/**
 * Key names treated as secrets in `key=value` segments (URL query params,
 * ADO.NET / JDBC `;`-separated pairs, libpq `key=value` lists). Matched
 * case-insensitively against the whole key, so `Password`, `PWD`,
 * `sslpassword`, `AccessToken`, `client_secret`, `api_key` all match.
 */
const SECRET_KEY_SOURCE = String.raw`[\w .-]*?(?:pass(?:word|wd)?|pwd|secret|token|api[\s_-]?key)`;
const SECRET_KEY = new RegExp(`^${SECRET_KEY_SOURCE}$`, "i");

/** True when a connection-string key names a secret (`Password`, `pwd`, `sslpassword`, …). */
export function isSecretConnectionKey(key: string): boolean {
  return SECRET_KEY.test(key.trim());
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** True when the input starts with `scheme://`. */
export function hasUrlScheme(input: string): boolean {
  return URL_SCHEME.test(input.trim());
}

/**
 * Mask the password in a URL's userinfo (`scheme://user:secret@host` →
 * `scheme://user:****@host`). Parsed by hand rather than with `new URL()`:
 * non-special schemes such as `sqlserver:` get an opaque host, and passwords
 * frequently contain unencoded reserved characters. The authority runs to the
 * first `/`, `?` or `#`; userinfo is everything before the authority's *last*
 * `@`. Everything after the first `:` in that userinfo is masked, even if that
 * over-masks an unusual string. Inputs without a scheme are returned unchanged.
 */
export function redactUrlUserinfo(input: string): string {
  const match = URL_SCHEME.exec(input);
  if (!match) return input;
  const schemeEnd = match[0].length;
  const rest = input.slice(schemeEnd);
  const authorityEnd = firstIndexOf(rest, ["/", "?", "#"]);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at === -1) return input;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return input;
  const maskedUserinfo = `${userinfo.slice(0, colon)}:${REDACTED_SECRET}`;
  return input.slice(0, schemeEnd) + maskedUserinfo + rest.slice(at);
}

export type RedactKeyValueOptions = {
  /**
   * Characters that end an unquoted value. Default `";&"` — ADO.NET/JDBC
   * `;key=value` pairs and URL query `&key=value` params. Pass `";"` for pure
   * ADO.NET strings, where `&` may appear inside a password.
   */
  separators?: string;
  /**
   * Also end unquoted values at whitespace (libpq `key=value key=value` form).
   * Off by default because ADO.NET values may legitimately contain spaces
   * (`Password=my pass;`); leaving it off can only over-mask.
   */
  whitespaceSeparated?: boolean;
};

function escapeForCharClass(chars: string): string {
  return chars.replace(/[\]\\^-]/g, "\\$&");
}

/**
 * Mask the values of secret keys in `key=value` segments. A key must start at
 * the string start or right after a separator, `?`, or whitespace, and must
 * end in a secret word immediately before `=` (so `PasswordHint=` does not
 * match). Understands ADO.NET `{braced}` values (`}}` escapes) and
 * `'single'`/`"double"` quoted values (doubled or backslash-escaped quotes),
 * so a quoted secret containing a separator is masked whole. Non-secret values
 * are never consumed, so a secret assignment anywhere in the string is found.
 */
export function redactSecretKeyValues(
  input: string,
  options: RedactKeyValueOptions = {},
): string {
  const separators = options.separators ?? ";&";
  const ws = options.whitespaceSeparated === true;
  const re = new RegExp(
    `(^|[${escapeForCharClass(separators)}?\\s])(${SECRET_KEY_SOURCE})(\\s*=\\s*)`,
    "gi",
  );
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const valueStart = match.index + match[0].length;
    const valueEnd = findValueEnd(input, valueStart, separators, ws);
    out += input.slice(last, valueStart) + REDACTED_SECRET;
    last = valueEnd;
    if (valueEnd >= input.length) break;
    re.lastIndex = valueEnd;
  }
  return out + input.slice(last);
}

/**
 * Generic, engine-agnostic redaction: masks URL userinfo passwords and every
 * secret `key=value` pair (URL query string, JDBC-style `;key=value`, ADO.NET
 * `Password=…;` / `Pwd=…;`). Used as the fallback for providers without a
 * dedicated redactor. Non-URL strings are treated as `;`-separated (ADO.NET),
 * so a libpq-style `password=x dbname=y` list is over-masked, never leaked.
 */
export function redactConnectionStringGeneric(input: string): string {
  if (hasUrlScheme(input)) {
    return redactSecretKeyValues(redactUrlUserinfo(input), { separators: ";&" });
  }
  return redactSecretKeyValues(input, { separators: ";" });
}

function firstIndexOf(value: string, needles: readonly string[]): number {
  let best = -1;
  for (const needle of needles) {
    const idx = value.indexOf(needle);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function isSeparator(ch: string, separators: string, ws: boolean): boolean {
  return separators.includes(ch) || (ws && /\s/.test(ch));
}

/** Index just past the value that starts at `start` (quote/brace aware). */
function findValueEnd(
  input: string,
  start: number,
  separators: string,
  ws: boolean,
): number {
  let j = start;
  const open = input[j];
  if (open === "{" || open === "'" || open === '"') {
    const close = open === "{" ? "}" : open;
    j++;
    while (j < input.length) {
      const ch = input[j]!;
      if (ch === "\\" && open !== "{") {
        j += 2;
        continue;
      }
      if (ch === close) {
        if (input[j + 1] === close) {
          j += 2; // doubled delimiter is an escaped literal
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return input.length; // unterminated quote — mask to the end
  }
  while (j < input.length && !isSeparator(input[j]!, separators, ws)) j++;
  return j;
}
