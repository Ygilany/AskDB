import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import {
  createOptionalDriverLoader,
  rethrowDriverImportError,
  isDriverInstalled,
  missingDriverMessage,
  type DriverLoadOptions,
} from "@askdb/introspect/kit";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

// `mssql` is CJS with named exports; the runtime namespace and the type-time
// namespace agree (no `export =` quirk).
type MssqlModule = typeof import("mssql");

/**
 * Lazily resolve the optional `mssql` peer dependency. Mirrors the lazy-load
 * pattern in `@askdb/postgres` / `@askdb/mysql` so consumers with a custom
 * `CatalogQueryRunner` can import `@askdb/sqlserver` without `mssql` installed.
 */
const mssqlLoader = createOptionalDriverLoader<MssqlModule>({
  packageName: "mssql",
  importDriver: () => import("mssql").catch(rethrowDriverImportError),
  missingMessage: missingDriverMessage({ engine: "SQL Server", packageName: "mssql" }),
});

type MssqlDriverModule = MssqlModule;

/**
 * Resolve and cache the optional `mssql` peer driver, with the same lazy-import
 * + project-root fallback behavior as the catalog runner.
 */
export async function loadMssqlDriver(options?: DriverLoadOptions): Promise<MssqlDriverModule> {
  const mod = await mssqlLoader.load(options);
  return (mod as unknown as { default?: MssqlDriverModule }).default ?? mod;
}

export function isMssqlDriverInstalled(options?: DriverLoadOptions): boolean {
  return isDriverInstalled("mssql", options);
}

export type MssqlConfigInput = {
  server: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  options?: { encrypt?: boolean; trustServerCertificate?: boolean };
};

/**
 * mssql v12 uses @tediousjs/connection-string v1.x, which has two known gaps:
 *
 * 1. URL format (`mssql://…`, `sqlserver://…`) — the library is a pure ADO.NET
 *    key=value parser and silently produces an empty config, leaving `server`
 *    undefined.  We detect these schemes and parse them into config objects.
 *
 * 2. ADO.NET multi-word keys with spaces — the library schema uses the no-space
 *    form (`trustservercertificate`) but ADO.NET client tools emit keys with
 *    spaces (`Trust Server Certificate`).  After lowercasing by the parser these
 *    never match the schema, so options like TrustServerCertificate are silently
 *    dropped.  We normalise the affected keys before passing the string to mssql.
 *
 * ADO.NET strings are identified as anything that is not a URL (no `://`).
 */
export function resolveConnectionInput(connectionString: string): string | MssqlConfigInput {
  if (connectionString.startsWith("mssql://")) {
    return parseMssqlSchemeUrl(connectionString);
  }
  if (connectionString.startsWith("sqlserver://")) {
    return parsePrismaSqlServerUrl(connectionString);
  }
  // ADO.NET string: normalise multi-word keys that @tediousjs/connection-string
  // v1.x does not recognise in their spaced form.
  if (!connectionString.includes("://")) {
    return normalizeAdoNetString(connectionString);
  }
  return connectionString;
}

/**
 * @tediousjs/connection-string v1.x schema uses camelCase/no-space forms as
 * keys, but ADO.NET clients (VS Code mssql, SSMS) emit the space-separated
 * forms.  Map each affected key to the form the schema actually recognises.
 */
const ADO_NET_KEY_NORMALISATIONS: ReadonlyArray<[RegExp, string]> = [
  [/Trust\s+Server\s+Certificate\s*=/gi, "TrustServerCertificate="],
  [/Application\s+Intent\s*=/gi, "ApplicationIntent="],
  [/Multiple\s+Active\s+Result\s+Sets\s*=/gi, "MultipleActiveResultSets="],
  [/Connect\s+Retry\s+Count\s*=/gi, "ConnectRetryCount="],
  [/Connect\s+Retry\s+Interval\s*=/gi, "ConnectRetryInterval="],
  [/Transparent\s+Network\s+IP\s+Resolution\s*=/gi, "TransparentNetworkIpResolution="],
];

function normalizeAdoNetString(connectionString: string): string {
  let result = connectionString;
  for (const [pattern, replacement] of ADO_NET_KEY_NORMALISATIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function parseMssqlSchemeUrl(connectionString: string): MssqlConfigInput {
  const url = new URL(connectionString);
  const server = url.hostname;
  if (!server) {
    throw new AskDbError(
      "Cannot parse server hostname from SQL Server connection URL. " +
        "Expected format: mssql://USER:PASSWORD@HOST:PORT/DATABASE",
    );
  }
  const port = url.port ? parseInt(url.port, 10) : undefined;
  const database = url.pathname.length > 1 ? url.pathname.slice(1) : undefined;
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const encrypt = url.searchParams.get("encrypt");
  const trustCert = url.searchParams.get("trustServerCertificate") ?? url.searchParams.get("TrustServerCertificate");
  return {
    server,
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    ...(database ? { database } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    options: {
      ...(encrypt !== null ? { encrypt: !["false", "0", "no"].includes(encrypt.toLowerCase()) } : {}),
      ...(trustCert !== null ? { trustServerCertificate: !["false", "0", "no"].includes(trustCert.toLowerCase()) } : {}),
    },
  };
}

/**
 * Parse Prisma's SQL Server connection URL,
 * `sqlserver://HOST[:PORT][;key=value…]`.
 *
 * Backward compatible with the parser this replaces for every string it could
 * read: it connects with exactly the same values as before. Segments are split on `;`,
 * a key ends at its first `=` (so `password=a=b` is `a=b`), keys are trimmed
 * and lower-cased, values are trimmed, non-ASCII is fine, a segment without
 * `=` or with an empty key or value is skipped, and a later key replaces an
 * earlier one. The host part ends at its last `:`, and a port that isn't a
 * number is ignored.
 *
 * On top of that it reads Prisma's `{…}` escaping (Prisma's SQL Server docs:
 * "If your credentials contain `: \ = ; / [ ] { }`, wrap values in curly
 * braces", e.g. `password={Pass:Word;}`), but only where the old parser never
 * read the value as written: a value that starts with `{`, has a `;` before its
 * first `}`, and ends at a `}` whose `;`-separated piece holds no `=`. The old
 * parser cut such a value at its first `;` and dropped that last piece (a piece
 * without `=` is skipped), so it never connected with the value the user wrote.
 * The value is everything between the braces, read verbatim, so `;`, `=` and
 * braces inside it are part of it (`{{a;b}}` is `{a;b}`); it ends at the first
 * `}` followed only by blanks and then `;` or the end of the string.
 *
 * Any other `{` or `}` is a plain character, as before: `password={abc}` is
 * `{abc}`, and an unclosed `{` is part of the value. Braces that close before
 * any `;` never reach into a later value (`password={ab}cd;user={me}` reads
 * `{ab}cd` and `{me}`), and neither does a `{` whose closing `}` ends a later
 * `key=value` piece (`password={Xy7;user={me}` reads `{Xy7` and `{me}`).
 * This is where it differs from Prisma, which reads every `{…}` as an escape
 * (`{abc}` is `abc`) and ends it at the first `}`.
 *
 * Prisma's credential aliases are read (`username` and `uid` for `user`,
 * `pwd` for `password`) only when the canonical key is absent: the old parser
 * dropped them, so such a string had no credentials, and where the canonical
 * key is present it still wins. `initial catalog` is not, because the old parser ignored it and
 * the connection used the login's default database; reading it now would
 * change where a working string connects.
 */
function parsePrismaSqlServerUrl(connectionString: string): MssqlConfigInput {
  const segments = splitPrismaSegments(connectionString.slice("sqlserver://".length));
  const hostPart = unbrace(segments[0]!);

  const colonIdx = hostPart.lastIndexOf(":");
  const server = colonIdx === -1 ? hostPart : hostPart.slice(0, colonIdx);
  const portStr = colonIdx === -1 ? undefined : hostPart.slice(colonIdx + 1);
  const port = portStr ? parseInt(portStr, 10) : undefined;

  if (!server) {
    throw new AskDbError(
      "Cannot parse server hostname from Prisma-style SQL Server URL. " +
        "Expected: sqlserver://HOST:PORT;database=DATABASE;user=USER;password=PASSWORD",
    );
  }

  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.findIndex((piece) => !piece.braced && piece.text.includes("="));
    if (eq === -1) continue;
    const split = segment[eq]!.text.indexOf("=");
    const keyPieces = [...segment.slice(0, eq), { braced: false, text: segment[eq]!.text.slice(0, split) }];
    const valuePieces = [{ braced: false, text: segment[eq]!.text.slice(split + 1) }, ...segment.slice(eq + 1)];
    const key = unbrace(keyPieces).trim().toLowerCase();
    const value = trimUnbraced(valuePieces);
    if (key && value) params[key] = value;
  }

  // The canonical key wins, as it did when the aliases were ignored; an alias
  // is used only when the canonical key is absent.
  const pick = (...keys: string[]): string | undefined =>
    keys.map((key) => params[key]).find((value) => value !== undefined);
  const database = params["database"];
  const user = pick("user", "username", "uid");
  const password = pick("password", "pwd");

  return {
    server,
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    ...(database ? { database } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    options: {
      ...(params["encrypt"] !== undefined ? { encrypt: params["encrypt"].toLowerCase() === "true" } : {}),
      ...(params["trustservercertificate"] !== undefined
        ? { trustServerCertificate: params["trustservercertificate"].toLowerCase() === "true" }
        : {}),
    },
  };
}

/**
 * True when a Prisma-style `sqlserver://` string can be read more than one
 * way, so a display label must not trust its parts: it has a `{` (an escape
 * only around a whole value holding a `;`, while Prisma reads every `{…}` as
 * one), a quote, a segment that
 * isn't `key=value` (an unbraced `;` inside a value), an empty segment before
 * another one, or an unclosed `{`. The connection still uses
 * `parsePrismaSqlServerUrl`'s reading.
 */
export function isPrismaSqlServerUrlAmbiguous(connectionString: string): boolean {
  const rest = connectionString.slice("sqlserver://".length);
  if (/[{'"]/.test(rest)) return true;
  const segments = rest.split(";").slice(1);
  return segments.some((segment, i) => {
    const last = i === segments.length - 1;
    if (segment.trim() === "") return !last;
    return !segment.includes("=");
  });
}

type PrismaPiece = { braced: boolean; text: string };

/**
 * Split on `;` outside an escaping `{…}`; each segment keeps its braced and
 * plain pieces. A value is an escape (see `parsePrismaSqlServerUrl`) when it
 * starts with `{` (after `key=` and blanks), has a `;` before its first `}`,
 * and ends at a `}` followed only by blanks before the next `;` or the end of
 * the string. Everything else, including the host part, splits on every `;`.
 */
function splitPrismaSegments(input: string): PrismaPiece[][] {
  const hostEnd = input.indexOf(";");
  if (hostEnd === -1) return [[{ braced: false, text: input }]];
  const segments: PrismaPiece[][] = [[{ braced: false, text: input.slice(0, hostEnd) }]];
  let pos = hostEnd + 1;
  while (pos <= input.length) {
    const next = input.indexOf(";", pos);
    const end = next === -1 ? input.length : next;
    const escape = escapedValue(input, pos, end);
    if (escape) {
      segments.push(
        [
          { braced: false, text: input.slice(pos, escape.open) },
          { braced: true, text: input.slice(escape.open + 1, escape.close) },
          { braced: false, text: input.slice(escape.close + 1, escape.end) },
        ].filter((piece) => piece.braced || piece.text !== ""),
      );
      pos = escape.end + 1;
    } else {
      segments.push(end > pos ? [{ braced: false, text: input.slice(pos, end) }] : []);
      pos = end + 1;
    }
  }
  return segments;
}

/**
 * The escaping `{…}` of the segment starting at `start` (whose first `;` is at
 * `firstSemi`), or `undefined`: the value must start with `{`, a `;` must come
 * before the first `}` after it, the first `}` followed only by blanks and then
 * `;` or the end of the input closes it, and the `;`-separated piece that `}`
 * ends must hold no `=` (the old parser skipped that piece).
 */
function escapedValue(
  input: string,
  start: number,
  firstSemi: number,
): { open: number; close: number; end: number } | undefined {
  const eq = input.indexOf("=", start);
  if (eq === -1 || eq >= firstSemi) return undefined;
  let open = eq + 1;
  while (input[open] === " " || input[open] === "\t") open++;
  if (input[open] !== "{") return undefined;
  // A `}` before the value's first `;` means the braces wrap no `;`: plain text.
  const firstClose = input.indexOf("}", open + 1);
  if (firstClose === -1 || firstClose < firstSemi) return undefined;
  const closing = /\}[ \t]*(?:;|$)/g;
  closing.lastIndex = open + 1;
  const match = closing.exec(input);
  if (!match) return undefined;
  const close = match.index;
  // The piece the `}` ends is a `key=value` the old parser read: plain text.
  if (input.slice(input.lastIndexOf(";", close) + 1, close).includes("=")) return undefined;
  const end = match[0].endsWith(";") ? close + match[0].length - 1 : input.length;
  return { open, close, end };
}

function unbrace(pieces: readonly PrismaPiece[]): string {
  return pieces.map((piece) => piece.text).join("");
}

/** Join the pieces, trimming whitespace only from unbraced text at either end. */
function trimUnbraced(pieces: readonly PrismaPiece[]): string {
  const copy = pieces.map((piece) => ({ ...piece }));
  while (copy.length > 0 && !copy[0]!.braced) {
    copy[0]!.text = copy[0]!.text.trimStart();
    if (copy[0]!.text !== "") break;
    copy.shift();
  }
  while (copy.length > 0 && !copy[copy.length - 1]!.braced) {
    const last = copy[copy.length - 1]!;
    last.text = last.text.trimEnd();
    if (last.text !== "") break;
    copy.pop();
  }
  return unbrace(copy);
}

async function runSqlServerCatalogQuery(
  connectionString: string,
  sql: string,
  params: ReadonlyArray<unknown> | undefined,
  options?: DriverLoadOptions,
): Promise<CatalogQueryResult> {
  const mod = await mssqlLoader.load(options);
  const mssql = (mod as unknown as { default?: MssqlModule }).default ?? mod;
  const pool = new mssql.ConnectionPool(resolveConnectionInput(connectionString) as never);
  await pool.connect();
  try {
    const request = pool.request();
    // The connector currently issues only literal SQL (no parameters); honour
    // optional params via positional binding in case a custom caller plugs in.
    if (params) {
      for (let i = 0; i < params.length; i++) {
        request.input(`p${i}`, params[i] as never);
      }
    }
    const result = await request.query<Record<string, unknown>>(sql);
    const rows = result.recordset ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const data = rows.map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));
    return { columns, rows: data };
  } catch (e) {
    if (e instanceof AskDbError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new AskDbError(`SQL Server catalog query failed: ${message}`, e);
  } finally {
    await pool.close();
  }
}

/**
 * Build the built-in `mssql`-backed catalog query runner used by live SQL
 * Server introspection.  `connectionString` may be:
 * - ADO.NET format:  `Server=host,1433;Database=db;User Id=u;Password=p;`
 * - `mssql://` URL:  `mssql://user:pass@host:1433/database`
 * - Prisma format:   `sqlserver://host:1433;database=db;user=u;password=p`
 *
 * mssql v12+ only understands ADO.NET strings; URL formats are converted to a
 * config object automatically.
 */
export function createSqlServerCatalogQueryRunner(
  connectionString: string,
  options?: DriverLoadOptions,
): CatalogQueryRunner {
  return (sql, params) => runSqlServerCatalogQuery(connectionString, sql, params, options);
}
