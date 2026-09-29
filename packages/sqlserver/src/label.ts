import type { ConnectionLabelParts } from "@askdb/connectors";
import { MSSQL_SCHEMA, parse } from "@tediousjs/connection-string";
import { resolveConnectionInput } from "./exec/sqlserver.js";

/**
 * The display-safe parts of a SQL Server connection string, read by the same
 * code the connection uses — never a reimplementation of the grammar
 * (ADR 0011):
 *
 * - `resolveConnectionInput()` turns `mssql://…` and the Prisma/JDBC-style
 *   `sqlserver://host:port;key=value` form into `{ server, port, database }`,
 *   and hands ADO.NET strings to `mssql`;
 * - `mssql` parses ADO.NET strings with `@tediousjs/connection-string`
 *   (`parse(…).toSchema(MSSQL_SCHEMA)`), then splits `data source` into
 *   server, instance and port. The split below mirrors that step; a
 *   differential test checks the result against `mssql`'s own
 *   `ConnectionPool.parseConnectionString`.
 *
 * Returns `undefined` (the registry labels it `configured sqlserver
 * connection`) when a parser throws, when there is no server, for a named
 * instance or named pipe, for any other scheme, for an `@` in the
 * `sqlserver://` form (it has no userinfo), and for an `@` or `#` after the
 * host of an `mssql://` URL (a password containing `/`, `?` or `#` is split
 * there). `formatConnectionLabel`'s allowlist is the second check.
 */
export function parseSqlServerConnection(input: string): ConnectionLabelParts | undefined {
  let resolved: ReturnType<typeof resolveConnectionInput>;
  try {
    resolved = resolveConnectionInput(input);
  } catch {
    return undefined;
  }
  if (typeof resolved === "string") {
    return resolved.includes("://") ? undefined : adoNetParts(resolved);
  }
  if (input.startsWith("sqlserver://") && input.includes("@")) return undefined;
  if (input.startsWith("mssql://") && !mssqlUrlIsUnambiguous(input)) return undefined;
  return parts(resolved.server, resolved.port === undefined ? undefined : String(resolved.port), resolved.database);
}

function mssqlUrlIsUnambiguous(input: string): boolean {
  const url = new URL(input);
  return url.hash === "" && !`${url.pathname}${url.search}`.includes("@");
}

function adoNetParts(connectionString: string): ConnectionLabelParts | undefined {
  let schema: Record<string, unknown>;
  try {
    schema = parse(connectionString).toSchema(MSSQL_SCHEMA);
  } catch {
    return undefined;
  }
  const dataSource = schema["data source"];
  const database = schema["initial catalog"];
  if (typeof dataSource !== "string" || (database !== undefined && typeof database !== "string")) {
    return undefined;
  }
  // mssql's `data source` handling: `np:` is rejected, `tcp:` stripped,
  // `server\instance` names an instance, `server,port` sets the port.
  if (/^np:/i.test(dataSource)) return undefined;
  const address = dataSource.replace(/^tcp:/i, "");
  if (address.includes("\\")) return undefined;
  const comma = /^(.*),(.*)$/.exec(address);
  const server = (comma ? comma[1]! : address).trim();
  const port = comma ? comma[2]!.trim() : undefined;
  const host = server === "." || /^\((local|\.|localdb)\)$/i.test(server) ? "localhost" : server;
  return parts(host, port, database);
}

function parts(host: string, port: string | undefined, database: string | undefined): ConnectionLabelParts {
  return {
    ...(host !== "" ? { host } : {}),
    ...(port !== undefined && port !== "" ? { port } : {}),
    ...(database !== undefined && database !== "" ? { database } : {}),
  };
}
