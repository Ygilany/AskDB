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
  options?: { encrypt?: boolean; trustServerCertificate?: boolean; instanceName?: string };
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
 * `sqlserver://HOST[\INSTANCE][:PORT][;key=value…]`, with the grammar of
 * Prisma's own JDBC-string parser (`prisma/connection-string`, `src/jdbc.rs`),
 * so a string that works with Prisma means the same thing here:
 *
 * - The structural characters are `: = \ / ; [ ]`. Any of them, and `{`, can
 *   appear in a key or value only inside `{…}`, which is read verbatim up to the
 *   first `}` (Prisma's docs: "If your credentials contain `: \ = ; / [ ] { }`,
 *   wrap values in curly braces", e.g. `password={Pass:Word;}`). Braced and
 *   plain runs join into one value, so `{abc;}}45}` is `abc;}45}`.
 * - Keys are lower-cased; a later key replaces an earlier one. Prisma's aliases
 *   are honoured: `database` / `initial catalog`, `user` / `username` / `uid`,
 *   `password` / `pwd`.
 * - Unlike Prisma, whitespace around an unbraced key or value is ignored
 *   (brace it to keep it), as the earlier parser did.
 *
 * Anything Prisma would reject throws: an unclosed `{`, a non-ASCII character,
 * a segment that isn't `key=value`, an empty key or value, a stray structural
 * character (so an unescaped `=` or a quoted value with `;` in it), a
 * non-numeric port, or two aliases of the same setting.
 */
function parsePrismaSqlServerUrl(connectionString: string): MssqlConfigInput {
  const tokens = tokenizeJdbc(connectionString.slice("sqlserver://".length));
  let i = 0;
  const peek = () => tokens[i];
  const invalid = (reason: string) =>
    new AskDbError(
      `Invalid Prisma-style SQL Server URL: ${reason}. ` +
        "Expected sqlserver://HOST[:PORT];database=DATABASE;user=USER;password=PASSWORD, " +
        "with any value containing : \\ = ; / [ ] { } wrapped in {curly braces}.",
    );
  const readIdent = (): string => {
    const parts: Array<{ text: string; braced: boolean }> = [];
    for (let token = peek(); token?.kind === "atom" || token?.kind === "escaped"; token = peek()) {
      parts.push({ text: token.text, braced: token.kind === "escaped" });
      i++;
    }
    // Unbraced whitespace at either end is not part of the value.
    while (parts.length > 0 && !parts[0]!.braced && /^\s$/.test(parts[0]!.text)) parts.shift();
    while (parts.length > 0 && !parts[parts.length - 1]!.braced && /^\s$/.test(parts[parts.length - 1]!.text)) {
      parts.pop();
    }
    return parts.map((part) => part.text).join("");
  };

  let server = "";
  if (peek()?.kind === "[") {
    i++;
    let ipv6 = "[";
    for (;;) {
      const token = tokens[i++];
      if (token?.kind === ":") ipv6 += ":";
      else if (token?.kind === "atom" && /^[0-9A-Za-z]$/.test(token.text)) ipv6 += token.text;
      else if (token?.kind === "]") break;
      else throw invalid("malformed IPv6 host");
    }
    server = `${ipv6}]`;
  } else {
    server = readIdent();
  }
  let instanceName: string | undefined;
  if (peek()?.kind === "\\") {
    i++;
    instanceName = readIdent();
    if (!instanceName) throw invalid("empty instance name");
  }
  let port: number | undefined;
  if (peek()?.kind === ":") {
    i++;
    const portText = readIdent();
    if (!/^\+?\d+$/.test(portText) || Number(portText) > 65535) throw invalid("the port is not a number");
    port = Number(portText);
  }
  if (!server) {
    throw new AskDbError(
      "Cannot parse server hostname from Prisma-style SQL Server URL. " +
        "Expected: sqlserver://HOST:PORT;database=DATABASE;user=USER;password=PASSWORD",
    );
  }

  const params = new Map<string, string>();
  while (peek()?.kind === ";") {
    i++;
    if (peek() === undefined) break; // a trailing ";"
    const key = readIdent().toLowerCase();
    if (!key) throw invalid("empty property key");
    if (tokens[i++]?.kind !== "=") throw invalid(`property "${key}" must be joined to its value by =`);
    const value = readIdent();
    if (!value) throw invalid(`property "${key}" has no value`);
    params.set(key, value);
  }
  if (peek() !== undefined) throw invalid(`unexpected "${peek()!.text}"`);

  const pick = (...aliases: string[]): string | undefined => {
    const present = aliases.filter((alias) => params.has(alias));
    if (present.length > 1) throw invalid(`set only one of ${present.join(", ")}`);
    return present.length === 1 ? params.get(present[0]!) : undefined;
  };
  const database = pick("database", "initial catalog");
  const user = pick("user", "username", "uid");
  const password = pick("password", "pwd");
  const encrypt = params.get("encrypt");
  const trustServerCertificate = params.get("trustservercertificate");

  return {
    server,
    ...(port !== undefined ? { port } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(password !== undefined ? { password } : {}),
    options: {
      ...(encrypt !== undefined ? { encrypt: encrypt.toLowerCase() === "true" } : {}),
      ...(trustServerCertificate !== undefined
        ? { trustServerCertificate: trustServerCertificate.toLowerCase() === "true" }
        : {}),
      ...(instanceName !== undefined ? { instanceName } : {}),
    },
  };
}

type JdbcToken =
  | { kind: ":" | "=" | "\\" | "/" | ";" | "[" | "]"; text: string }
  | { kind: "atom" | "escaped"; text: string };

/** Prisma's JDBC lexer: structural characters, `{…}` escapes (to the first `}`), and ASCII atoms. */
function tokenizeJdbc(input: string): JdbcToken[] {
  const tokens: JdbcToken[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch.charCodeAt(0) > 0x7f) {
      throw new AskDbError(
        "Invalid Prisma-style SQL Server URL: non-ASCII character. Prisma's SQL Server URLs accept ASCII only.",
      );
    }
    if (ch === ":" || ch === "=" || ch === "\\" || ch === "/" || ch === ";" || ch === "[" || ch === "]") {
      tokens.push({ kind: ch, text: ch });
    } else if (ch === "{") {
      const close = input.indexOf("}", i + 1);
      if (close === -1) {
        throw new AskDbError(
          "Invalid Prisma-style SQL Server URL: a { is never closed. Wrap each special value as {value}.",
        );
      }
      const text = input.slice(i + 1, close);
      if (/[^\u0000-\u007f]/.test(text)) {
        throw new AskDbError(
          "Invalid Prisma-style SQL Server URL: non-ASCII character. Prisma's SQL Server URLs accept ASCII only.",
        );
      }
      tokens.push({ kind: "escaped", text });
      i = close;
    } else {
      tokens.push({ kind: "atom", text: ch });
    }
  }
  return tokens;
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
