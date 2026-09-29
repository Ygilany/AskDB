import { parseConnectionUrl, type ConnectionLabelParts } from "@askdb/connectors";

const SERVER_KEYS = ["server", "data source", "address", "addr", "network address"];
const DATABASE_KEYS = ["database", "initial catalog"];

/**
 * The display-safe parts of a SQL Server connection string: host, port and
 * database, parsed from the three forms `resolveConnectionInput()` accepts:
 *
 * - `mssql://user:password@host:1433/db`
 * - Prisma/JDBC style `sqlserver://host:1433;database=db;user=sa;password=…`
 * - ADO.NET `Server=tcp:host,1433;Database=db;User Id=sa;Password=…;`
 *
 * User names, passwords and every other key are never returned. A string that
 * does not parse cleanly returns `undefined`, so the registry labels it
 * `configured sqlserver connection`: a quoted or `{braced}` value with text after
 * its closing delimiter, a segment that is not `key=value`, a repeated key, an
 * `@` in the `sqlserver://` form, a named instance, any other scheme, or one of
 * the spellings the driver's own parser reads differently (an escaped `;;` or a
 * value starting with `;`).
 */
export function parseSqlServerConnection(input: string): ConnectionLabelParts | undefined {
  if (/[\u0000-\u001f\u007f]/.test(input)) return undefined;
  if (/^mssql:\/\//i.test(input)) return parseConnectionUrl(input, ["mssql"]);
  if (/^sqlserver:\/\//i.test(input)) return parsePrismaForm(input.slice("sqlserver://".length));
  if (input.includes("://")) return undefined;
  return parseAdoNetForm(input);
}

/** `host[:port][;key=value…]`. The form has no userinfo, so any `@` means it was misused as a URL. */
function parsePrismaForm(rest: string): ConnectionLabelParts | undefined {
  if (rest.includes("@")) return undefined;
  const semi = rest.indexOf(";");
  const pairs = parseKeyValuePairs(semi === -1 ? "" : rest.slice(semi + 1));
  if (!pairs) return undefined;
  const hostPart = semi === -1 ? rest : rest.slice(0, semi);
  const pieces = hostPart.split(":");
  if (pieces.length > 2) return undefined;
  return withDatabase({ host: pieces[0]!, port: pieces[1] }, pairs);
}

function parseAdoNetForm(input: string): ConnectionLabelParts | undefined {
  const pairs = parseKeyValuePairs(input);
  if (!pairs) return undefined;
  const server = single(pairs, SERVER_KEYS);
  if (server === null || server === undefined) return undefined;
  // `tcp:host,port` / `host,port` / `host`. Other protocols (`np:`, `lpc:`) fall back.
  const address = server.replace(/^tcp:/i, "");
  const pieces = address.split(",");
  if (pieces.length > 2) return undefined;
  return withDatabase({ host: pieces[0]!.trim(), port: pieces[1]?.trim() }, pairs);
}

function withDatabase(
  target: { host: string; port: string | undefined },
  pairs: ReadonlyMap<string, string>,
): ConnectionLabelParts | undefined {
  const database = single(pairs, DATABASE_KEYS);
  if (database === null) return undefined;
  return {
    host: target.host,
    ...(target.port === undefined ? {} : { port: target.port }),
    ...(database === undefined ? {} : { database }),
  };
}

/** The value of the one key in `aliases` that is present; `null` when two aliases are both set. */
function single(pairs: ReadonlyMap<string, string>, aliases: readonly string[]): string | undefined | null {
  const present = aliases.filter((key) => pairs.has(key));
  if (present.length > 1) return null;
  return present.length === 1 ? pairs.get(present[0]!) : undefined;
}

/**
 * Strict ADO.NET-style `key=value;key=value` tokenizer (keys trimmed and
 * lower-cased). A value is unquoted (no `{`, `}`, `'` or `"`), or wrapped in
 * `{…}`, `'…'` or `"…"` with the closing delimiter doubled to escape it; only
 * whitespace may follow the closing delimiter before `;`.
 *
 * `mssql` parses ADO.NET strings with `@tediousjs/connection-string`, which
 * reads some spellings differently from a plain split on `;`: an unquoted `;;`
 * is an escaped `;` inside the value, a value whose first non-blank character
 * is `;` keeps it, a `;` where a key should start becomes part of that key, and
 * `key==` escapes `=` inside the key. Each of those returns `undefined`, as does
 * any other broken segment or a repeated key, so the label never shows text the
 * driver reads as part of a password. Separators at the very end are allowed.
 */
function parseKeyValuePairs(input: string): Map<string, string> | undefined {
  const pairs = new Map<string, string>();
  let i = 0;
  for (;;) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) return pairs;
    if (input[i] === ";") return /^[\s;]*$/.test(input.slice(i)) ? pairs : undefined;
    const eq = input.indexOf("=", i);
    if (eq === -1 || input[eq + 1] === "=") return undefined;
    const key = input.slice(i, eq).trim().toLowerCase();
    if (!/^[a-z][a-z0-9 _]*$/.test(key) || pairs.has(key)) return undefined;
    let j = eq + 1;
    while (j < input.length && /[ \t]/.test(input[j]!)) j++;
    const open = input[j];
    let value = "";
    if (open === ";") return undefined;
    if (open === "{" || open === "'" || open === '"') {
      const close = open === "{" ? "}" : open;
      j++;
      for (;;) {
        if (j >= input.length) return undefined;
        if (input[j] === close) {
          if (input[j + 1] !== close) break;
          j++;
        }
        value += input[j];
        j++;
      }
      j++;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      if (j < input.length && input[j] !== ";") return undefined;
    } else {
      const end = input.indexOf(";", j);
      const raw = input.slice(j, end === -1 ? input.length : end);
      if (/[{}'"]/.test(raw)) return undefined;
      value = raw.trim();
      j = end === -1 ? input.length : end;
    }
    pairs.set(key, value);
    // Step over the one `;` that ends this pair; another `;` right after it is
    // an empty segment, which the loop only accepts at the end of the string.
    i = j + 1;
  }
}
