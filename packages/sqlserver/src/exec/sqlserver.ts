import { AskDbError } from "@askdb/core";
import type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type { CatalogQueryResult, CatalogQueryRunner } from "@askdb/introspect";

// `mssql` is CJS with named exports; the runtime namespace and the type-time
// namespace agree (no `export =` quirk).
type MssqlModule = typeof import("mssql");

/**
 * Lazily resolve the optional `mssql` peer dependency. Mirrors the lazy-load
 * pattern in `@askdb/postgres` / `@askdb/mysql` so consumers with a custom
 * `CatalogQueryRunner` can import `@askdb/sqlserver` without `mssql` installed.
 */
type DriverLoadOptions = { resolveFrom?: string };

let mssqlModulePromises = new Map<string | undefined, Promise<MssqlModule>>();

function isModuleResolutionFailure(cause: unknown, packageName: string): boolean {
  if (!(cause instanceof Error)) return false;
  const nestedCause = (cause as { cause?: unknown }).cause;
  if (nestedCause && nestedCause !== cause && isModuleResolutionFailure(nestedCause, packageName)) {
    return true;
  }
  const code = (cause as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  return cause.message.includes(packageName);
}

async function importOptionalMssql(opts?: DriverLoadOptions): Promise<MssqlModule> {
  try {
    return await import("mssql");
  } catch (cause) {
    if (!isModuleResolutionFailure(cause, "mssql")) throw cause;

    const fromDir = opts?.resolveFrom ?? process.cwd();
    const projectRequire = createRequire(join(fromDir, "package.json"));
    try {
      const resolved = projectRequire.resolve("mssql");
      return (await import(pathToFileURL(resolved).href)) as MssqlModule;
    } catch (projectCause) {
      if (!isModuleResolutionFailure(projectCause, "mssql")) throw projectCause;
      throw new AggregateError([cause, projectCause], "Unable to resolve optional `mssql` peer dependency");
    }
  }
}

async function loadMssqlOrThrow(opts?: DriverLoadOptions): Promise<MssqlModule> {
  const key = opts?.resolveFrom;
  let promise = mssqlModulePromises.get(key);
  if (!promise) {
    promise = importOptionalMssql(opts).catch((cause) => {
      mssqlModulePromises.delete(key);
      throw new AskDbError(
        "The built-in SQL Server catalog query runner requires the optional `mssql` peer dependency. " +
          "Install it in your project (e.g. `pnpm add mssql`) or include it in the same one-off command " +
          "(e.g. `pnpm dlx -p askdb -p mssql askdb ...` or `npx -p askdb -p mssql askdb ...`). " +
          "You can also pass a custom catalog query runner to the SQL Server connector.",
        cause,
      );
    });
    mssqlModulePromises.set(key, promise);
  }
  return promise;
}

/** @internal exposed for tests that need to reset the lazy `mssql` cache. */
export function __resetMssqlModuleCacheForTests(): void {
  mssqlModulePromises.clear();
}

type MssqlDriverModule = MssqlModule;

/**
 * Resolve and cache the optional `mssql` peer driver, with the same lazy-import
 * + project-root fallback behavior as the catalog runner.
 */
export async function loadMssqlDriver(options?: DriverLoadOptions): Promise<MssqlDriverModule> {
  const mod = await loadMssqlOrThrow(options);
  return (mod as unknown as { default?: MssqlDriverModule }).default ?? mod;
}

export function isMssqlDriverInstalled(options?: DriverLoadOptions): boolean {
  try {
    const req = createRequire(join(options?.resolveFrom ?? process.cwd(), "package.json"));
    req.resolve("mssql");
    return true;
  } catch {
    return false;
  }
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
 * Backward compatible with the parser this replaces for every string without
 * `{`: it connects with exactly the same values as before. Segments are split on `;`,
 * a key ends at its first `=` (so `password=a=b` is `a=b`), keys are trimmed
 * and lower-cased, values are trimmed, non-ASCII is fine, a segment without
 * `=` or with an empty key or value is skipped, and a later key replaces an
 * earlier one. The host part ends at its last `:`, and a port that isn't a
 * number is ignored.
 *
 * On top of that it reads Prisma's `{…}` escaping (Prisma's SQL Server docs:
 * "If your credentials contain `: \ = ; / [ ] { }`, wrap values in curly
 * braces", e.g. `password={Pass:Word;}`), with the rule of Prisma's own
 * JDBC-string parser (`prisma/connection-string`, `src/jdbc.rs`): a `{` opens
 * a span read verbatim up to the first `}`, so `;` and `=` inside it are part
 * of the value, and braced and plain runs join (`{abc;}}45}` is `abc;}45}`).
 * That changes a value holding a literal `{`: the old parser kept braces as
 * plain characters (`password={abc}` was `{abc}`, now `abc`; `ab{cd` now
 * throws). A literal brace is written inside a braced run: `{a{b}}c` is
 * `a{b}c`.
 * Prisma's credential aliases are read (`username` and `uid` for `user`,
 * `pwd` for `password`) only when the canonical key is absent: the old parser
 * dropped them, so such a string had no credentials, and where the canonical
 * key is present it still wins. `initial catalog` is not, because the old parser ignored it and
 * the connection used the login's default database; reading it now would
 * change where a working string connects.
 *
 * It throws only for a `{` that is never closed.
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
 * way, so a display label must not trust its parts: it uses `{…}` (the parser
 * before Prisma escaping read the braces literally), a quote, a segment that
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

/** Split on `;` outside `{…}`; each segment keeps its braced and plain pieces. */
function splitPrismaSegments(input: string): PrismaPiece[][] {
  const segments: PrismaPiece[][] = [[]];
  let plain = "";
  const flush = () => {
    if (plain) segments[segments.length - 1]!.push({ braced: false, text: plain });
    plain = "";
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "{") {
      const close = input.indexOf("}", i + 1);
      if (close === -1) {
        throw new AskDbError(
          "Prisma-style SQL Server URL has a { that is never closed. Wrap a value that contains " +
            ": \\ = ; / [ ] { } in curly braces, e.g. password={Pass:Word;}.",
        );
      }
      flush();
      segments[segments.length - 1]!.push({ braced: true, text: input.slice(i + 1, close) });
      i = close;
    } else if (ch === ";") {
      flush();
      segments.push([]);
    } else {
      plain += ch;
    }
  }
  flush();
  return segments;
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
  const mod = await loadMssqlOrThrow(options);
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
