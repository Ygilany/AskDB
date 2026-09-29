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

// Leading whitespace is allowed (and kept in the output): a config value such
// as " postgres://u:secret@h/db" must still be recognised as a URL, or its
// userinfo would never be masked.
const URL_SCHEME = /^\s*[a-z][a-z0-9+.-]*:\/\//i;

/** True when the input starts with `scheme://`, after any leading whitespace. */
export function hasUrlScheme(input: string): boolean {
  return URL_SCHEME.test(input);
}

/**
 * Mask the password in a URL's userinfo (`scheme://user:secret@host` →
 * `scheme://user:****@host`). Parsed by hand rather than with `new URL()`:
 * non-special schemes such as `sqlserver:` get an opaque host, and passwords
 * frequently contain unencoded reserved characters. Userinfo runs from
 * `scheme://` to the *last* `@` in the string, so an unencoded `/`, `?`, `#`
 * or `@` in a password cannot end it early and leave part of the password
 * visible. Everything after the first `:` in that userinfo is masked; an `@`
 * in the path or query therefore over-masks rather than leaks. Userinfo
 * without a `:` carries no password, and inputs without a scheme are returned
 * unchanged.
 *
 * This masks userinfo only. For a URL that may also carry secret `key=value`
 * pairs, use `redactUrlConnectionString()`.
 */
export function redactUrlUserinfo(input: string): string {
  return maskRanges(input, userinfoPasswordRanges(input));
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
 * so a quoted secret containing a separator is masked whole. An unquoted
 * secret followed by a segment that is not `key=value` (an unescaped separator
 * inside the secret, as in `Password=ab;cd;Database=x`) is masked to the end
 * of the string. Non-secret values are never consumed, so a secret assignment
 * anywhere in the string is found.
 */
export function redactSecretKeyValues(
  input: string,
  options: RedactKeyValueOptions = {},
): string {
  return maskRanges(input, secretValueRanges(input, options));
}

/**
 * Mask a URL-form connection string: the userinfo password (as
 * `redactUrlUserinfo()`) and every secret `key=value` pair (as
 * `redactSecretKeyValues()` with `options`). Both are located in the original
 * input and masked together, so a secret that looks like the other kind
 * (`?password=p@ss` after a `host:port`, or `u:p&password=x@host`) is masked
 * whole instead of being split between two passes.
 */
export function redactUrlConnectionString(
  input: string,
  options: RedactKeyValueOptions = {},
): string {
  return maskRanges(input, [
    ...userinfoPasswordRanges(input),
    ...secretValueRanges(input, options),
  ]);
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
    return redactUrlConnectionString(input, { separators: ";&" });
  }
  return redactSecretKeyValues(input, { separators: ";" });
}

/** A `[start, end)` span of the input to replace with `REDACTED_SECRET`. */
type Range = readonly [start: number, end: number];

function userinfoPasswordRanges(input: string): Range[] {
  const match = URL_SCHEME.exec(input);
  if (!match) return [];
  const schemeEnd = match[0].length;
  const at = input.lastIndexOf("@");
  if (at < schemeEnd) return [];
  const colon = input.indexOf(":", schemeEnd);
  if (colon === -1 || colon > at) return [];
  return [[colon + 1, at]];
}

function secretValueRanges(input: string, options: RedactKeyValueOptions): Range[] {
  const separators = options.separators ?? ";&";
  const ws = options.whitespaceSeparated === true;
  const re = new RegExp(
    `(^|[${escapeForCharClass(separators)}?\\s])(${SECRET_KEY_SOURCE})(\\s*=\\s*)`,
    "gi",
  );
  const ranges: Range[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const valueStart = match.index + match[0].length;
    let valueEnd = findValueEnd(input, valueStart, separators, ws);
    // An unquoted secret followed by text that is not a `key=value` pair
    // (`Password=ab;cd;Database=x`) most likely contains an unescaped
    // separator. The driver would reject or misread it, so its real end is
    // unknown: mask to the end of the string rather than show the rest.
    if (!isQuoteOrBrace(input[valueStart]) && !remainderStartsWithPair(input, valueEnd, separators, ws)) {
      valueEnd = input.length;
    }
    ranges.push([valueStart, valueEnd]);
    if (valueEnd >= input.length) break;
    re.lastIndex = valueEnd;
  }
  return ranges;
}

function isQuoteOrBrace(ch: string | undefined): boolean {
  return ch === "{" || ch === "'" || ch === '"';
}

/**
 * True when the first non-empty segment after the separator at `from` looks
 * like `key=value` (or only empty segments remain).
 */
function remainderStartsWithPair(
  input: string,
  from: number,
  separators: string,
  ws: boolean,
): boolean {
  let i = from;
  while (i < input.length) {
    const start = i + 1; // skip the separator at i
    let end = start;
    while (end < input.length && !isSeparator(input[end]!, separators, ws)) end++;
    const segment = input.slice(start, end);
    if (segment.trim() !== "") return segment.includes("=");
    i = end;
  }
  return true;
}

/** Replace each range (overlapping or touching ranges merged) with one `REDACTED_SECRET`. */
function maskRanges(input: string, ranges: readonly Range[]): string {
  if (ranges.length === 0) return input;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = "";
  let last = 0;
  let [start, end] = sorted[0]!;
  for (const [s, e] of sorted.slice(1)) {
    if (s <= end) {
      end = Math.max(end, e);
      continue;
    }
    out += input.slice(last, start) + REDACTED_SECRET;
    last = end;
    [start, end] = [s, e];
  }
  return out + input.slice(last, start) + REDACTED_SECRET + input.slice(end);
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
  if (isQuoteOrBrace(open)) {
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
