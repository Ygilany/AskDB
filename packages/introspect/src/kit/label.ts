/**
 * Connection labels: the credential-free text shown for a configured database
 * connection (Studio's `GET /api/introspect/status` `sourceLabel`).
 *
 * A label is built only from parts an engine's parser extracted cleanly — host,
 * port, database, or a SQLite file path — and only when each part passes the
 * allowlist below. No other substring of the input is ever copied. Input that
 * does not parse cleanly, or a part that fails its allowlist, becomes
 * `configured <engine> connection`. Nothing here masks: see
 * docs/adrs/0011-connection-labels-from-parsed-parts.md for why.
 */

/** What an engine's parser may hand to `formatConnectionLabel`. */
export type ConnectionLabelParts =
  | { host?: string; port?: string; database?: string }
  | { file: string };

const HOST = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?|\[[0-9A-Fa-f:.]+\])$/;
const PORT = /^[0-9]{1,5}$/;
const DATABASE = /^[A-Za-z0-9_$.-]+$/;
// A plain filesystem path: no control characters, and none of the characters
// that would make it a URI query/fragment, a `key=value` list, or userinfo.
const FILE = /^[^\u0000-\u001f\u007f?#;=@]+$/;

/**
 * Build a connection label from parsed parts: `<engine>://host[:port][/database]`
 * for network engines, the path itself for a file. Returns
 * `configured <engine> connection` when `parts` is `undefined` (the input did
 * not parse) or any part fails its allowlist. The shape is checked at runtime
 * too, because a plain-JS adapter can return anything: a value that isn't a
 * plain object (a string, an array, a `URL`), or a part that isn't a string,
 * also gets the fallback instead of throwing.
 */
export function formatConnectionLabel(
  engine: string,
  parts: ConnectionLabelParts | undefined,
): string {
  const fallback = `configured ${engine} connection`;
  if (!isPlainObject(parts)) return fallback;
  if ("file" in parts) {
    const { file } = parts;
    return typeof file === "string" && FILE.test(file) && !file.includes("://") ? file : fallback;
  }
  const raw = parts as { host?: unknown; port?: unknown; database?: unknown };
  if (![raw.host, raw.port, raw.database].every((part) => part === undefined || typeof part === "string")) {
    return fallback;
  }
  const { host, port, database } = raw as { host?: string; port?: string; database?: string };
  if (host === undefined && database === undefined) return fallback;
  if (host !== undefined && !HOST.test(host)) return fallback;
  if (port !== undefined && (host === undefined || !PORT.test(port))) return fallback;
  if (database !== undefined && !DATABASE.test(database)) return fallback;
  return `${engine}://${host ?? ""}${port === undefined ? "" : `:${port}`}${
    database === undefined ? "" : `/${database}`
  }`;
}

function isPlainObject(value: unknown): value is ConnectionLabelParts {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// scheme://authority[/path][?query] — no fragment, and the whole input must match.
const URL_FORM = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(?:\?[^#]*)?$/;

/**
 * Parse a standard `scheme://[user[:password]@]host[:port][/database][?query]`
 * connection URL (Postgres, MySQL, SQL Server `mssql://`) into label parts.
 * Userinfo and the query string are never returned. Returns `undefined` —
 * so the label falls back — when:
 *
 * - the scheme is not one of `schemes` (so `jdbc:postgresql://…`, a quoted
 *   URL, and `postgres:/…` all fall back);
 * - the input contains whitespace, a control character, or a `#`;
 * - an `@` appears after the authority (a password containing `/`, `?` or `#`
 *   cut the authority short, so where it ends is unknown);
 * - the host is not a single `host[:port]`, or the path has more than one segment.
 */
export function parseConnectionUrl(
  input: string,
  schemes: readonly string[],
): ConnectionLabelParts | undefined {
  if (/[\s\u0000-\u001f\u007f]/.test(input)) return undefined;
  const match = URL_FORM.exec(input);
  if (!match) return undefined;
  const [, scheme = "", authority = "", path = ""] = match;
  if (!schemes.includes(scheme.toLowerCase())) return undefined;
  const authorityEnd = scheme.length + "://".length + authority.length;
  if (input.includes("@", authorityEnd)) return undefined;
  const hostPort = splitHostPort(authority.slice(authority.lastIndexOf("@") + 1));
  if (!hostPort) return undefined;
  const database = path.length > 1 ? path.slice(1) : undefined;
  if (database?.includes("/")) return undefined;
  return {
    ...(hostPort.host === "" ? {} : { host: hostPort.host }),
    ...(hostPort.port === undefined ? {} : { port: hostPort.port }),
    ...(database === undefined ? {} : { database }),
  };
}

function splitHostPort(value: string): { host: string; port?: string } | undefined {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close === -1) return undefined;
    const rest = value.slice(close + 1);
    if (rest === "") return { host: value.slice(0, close + 1) };
    return rest.startsWith(":") ? { host: value.slice(0, close + 1), port: rest.slice(1) } : undefined;
  }
  const pieces = value.split(":");
  if (pieces.length > 2) return undefined;
  return pieces.length === 2 ? { host: pieces[0]!, port: pieces[1]! } : { host: value };
}
