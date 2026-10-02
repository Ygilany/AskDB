import mssql from "mssql";
import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "@askdb/connectors";
import { sqlServerConnectorProvider } from "./connector/provider.js";
import { resolveConnectionInput } from "./exec/sqlserver.js";
import { parseSqlServerConnection } from "./label.js";

// The label hosts see: the adapter's parsed parts, built by the registry.
const registry = createConnectorRegistry([sqlServerConnectorProvider]);
const connectionLabel = (url: string) => registry.connectionLabel("sqlserver", { url });

const FALLBACK = "configured sqlserver connection";
const NBSP = " ";

// Inputs that leaked a secret through the earlier label code (review rounds
// 1-3 and the delta reviews on #189/#195/#199) sit next to ordinary strings in
// all three forms SQL Server accepts. The parts come from the driver's own
// parsers (ADR 0011), so the label names what the driver reads.
const CORPUS: ReadonlyArray<readonly [input: string, label: string]> = [
  // Ordinary mssql:// URLs.
  ["mssql://sa:S3cret@localhost:1433/app", "sqlserver://localhost:1433/app"],
  ["mssql://localhost/app", "sqlserver://localhost/app"],
  // Prisma-style strings. A {…} value is read differently by the parser before
  // Prisma escaping (it kept the braces), so the label doesn't trust it.
  ["sqlserver://host:1433;database=db;user=sa;password=S3cret;encrypt=true", "sqlserver://host:1433/db"],
  ["sqlserver://host:1433;database=db;user=sa;password={S3;cr&et};encrypt=true", FALLBACK],
  ["sqlserver://host:1433;user={MyServer/User};password={Pass:Word;};database=db", FALLBACK],
  // `initial catalog` isn't read for the connection (the old parser ignored it), so no database.
  ["sqlserver://db:1433;initial catalog=app;password=S3cret", "sqlserver://db:1433"],
  // Ordinary ADO.NET strings (mssql parses them with @tediousjs/connection-string).
  ["Server=tcp:host,1433;User Id=sa;Password=S3c&ret word;Trust Server Certificate=true", "sqlserver://host:1433"],
  ["Data Source=host;UID=sa;PWD='a;b';", "sqlserver://host"],
  ["Server=db,1433;Database=app;User Id=sa;Password=p@ss/w#rd;", "sqlserver://db:1433/app"],
  ["Server=db;Initial Catalog=app;Password={a}}b;c};", "sqlserver://db/app"],
  ["Server=(local);Database=app", "sqlserver://localhost/app"],
  // The original #189 leak: Studio's new URL() label showed the Prisma form's password.
  ["sqlserver://host;database=db;user=sa;password=S3cret", "sqlserver://host/db"],
  // Round 1: an @ in the password after host:port, and a / or # in a URL password.
  ["sqlserver://host:1433;database=db;user=sa;password=p@ssw0rd", FALLBACK],
  ["sqlserver://host:1433;database=db;user=sa;password={p@ss;w0rd}", FALLBACK],
  ["mssql://sa:S3/cret@host:1433/db", FALLBACK],
  ["mssql://sa:S3/cr@t#@db:1433/app", FALLBACK],
  // Round 2: leading whitespace, and an unescaped ; inside an unquoted password.
  [" mssql://sa:S3cret@localhost:1433/app", FALLBACK],
  [" sqlserver://host:1433;user=sa;password=S3cret;encrypt=true", FALLBACK],
  // The driver reads `cd;Database` as one key, so there is no database.
  ["Server=db;User Id=sa;Password=ab;cd;Database=app", "sqlserver://db"],
  // An unbraced ; inside a value is ambiguous: the connection keeps the old reading, the label falls back.
  ["sqlserver://db:1433;user=sa;password=ab;cd;database=app", FALLBACK],
  // Round 3: a quoted or braced value followed by trailing text (the ADO.NET parser throws).
  ["Server=db;Database=app;Password='ab'cd;", FALLBACK],
  ["Server=db;Database=app;Password={ab}cd;", FALLBACK],
  ["sqlserver://db:1433;database=app;password={ab}cd", FALLBACK],
  // Round 3: URL userinfo in the Prisma form, and JDBC, came back unchanged.
  ["sqlserver://sa:se;cret@h", FALLBACK],
  ["jdbc:sqlserver://h:1433;databaseName=app;user=sa;password=secret", FALLBACK],
  // Repeated keys and aliases: the driver keeps the last one.
  ["Server=db;Password=ab;Database=evil;Database=app", "sqlserver://db/app"],
  ["Server=a;Data Source=b;Database=app", "sqlserver://b/app"],
  // Named instances and named pipes aren't a host[:port] label.
  ["Server=localhost\\SQLEXPRESS;Database=app;Password=S3cret", FALLBACK],
  ["Server=np:\\\\.\\pipe\\sql\\query;Database=app", FALLBACK],
  ["User Id=sa;Password=S3cret", FALLBACK],
  // Delta review 2: the driver reads each of these as part of the password, so
  // no database (or server) comes from it.
  ["Server=h;User Id=sa;Password=p;;Database=leak", "sqlserver://h"],
  ["Server=h;User Id=sa;Password=;Database=leak", "sqlserver://h"],
  ["Data Source=h;Password=x;;Initial Catalog=leak", "sqlserver://h"],
  ["User Id=sa;Password=p;;Server=leakhost", FALLBACK],
  ["Server=h;Password='x';;Database=leak", "sqlserver://h"],
  ["Server=h;Password==;Database=leak", "sqlserver://h"],
  // An empty segment before another one is ambiguous too.
  ["sqlserver://h;password=p;;database=leak", FALLBACK],
  // Delta review 4: a ;database= inside a Prisma {…} value. The connection reads
  // it as part of the value; the label falls back, as for any {…} or quote.
  ["sqlserver://h:1433;database=app;user=sa;password={S3c;database=ret;}", FALLBACK],
  ["sqlserver://h;password={ab;database=cd;x}", FALLBACK],
  ["sqlserver://h;user={a;database=leak;}", FALLBACK],
  ['sqlserver://h;user=sa;password="S3c;database=ret;"', FALLBACK],
  ["sqlserver://h;password={S3c;database=ret", FALLBACK],
  // A Prisma named instance isn't a host[:port] label.
  ["sqlserver://h\\SQLEXPRESS:1433;database=app", FALLBACK],
  // Delta review 4: no server means no label, and mssql keeps the space after `tcp:`.
  ["Server=;Database=app", FALLBACK],
  ["Database=h;Addr=", FALLBACK],
  ["Data Source=tcp: leak", FALLBACK],
  // Delta review 3: Unicode whitespace before ";" (the driver keeps the ";" in the password).
  [`Server=h;User Id=sa;Password=${NBSP};Database=leak`, "sqlserver://h"],
  ["Server=h;User Id=sa;Password=　;Database=leak", "sqlserver://h"],
  ["Server=h;User Id=sa;Password=﻿;Database=leak", "sqlserver://h"],
  [`Server=h;User Id=sa;Password=${NBSP};Initial Catalog=leak`, "sqlserver://h"],
  [`User Id=sa;Password=${NBSP};Server=leakhost`, FALLBACK],
  // A trailing ";;" is an escaped ";": the driver's database is `app;`, which the allowlist rejects.
  ["Server=db;Database=app;;", FALLBACK],
  // The Prisma form has no userinfo, so any @ falls back (including user=name@server).
  ["sqlserver://host:1433;database=db;user=admin@corp;password=S3cret", FALLBACK],
];

describe("sqlserver connection label (sqlServerConnectorProvider.connectionLabelParts through the registry)", () => {
  it.each(CORPUS)("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});

// Differential: whenever the label shows a part, it is what the connection
// would use: resolveConnectionInput() for mssql:// and sqlserver://, and
// mssql's ConnectionPool.parseConnectionString for ADO.NET strings.
describe("sqlserver label parts match what the driver resolves", () => {
  const shown = CORPUS.map(([input]) => input).filter((input) => connectionLabel(input) !== FALLBACK);

  it.each(shown)("%s", (input) => {
    const parts = parseSqlServerConnection(input) as { host?: string; port?: string; database?: string };
    const resolved = resolveConnectionInput(input);
    const driver: { server?: string; port?: number; database?: string } =
      typeof resolved === "string" ? mssql.ConnectionPool.parseConnectionString(resolved) : resolved;
    expect(parts.host).toBe(driver.server);
    expect(parts.database).toBe(driver.database);
    // mssql fills in its default port 1433; the label shows a port only when the string sets one.
    if (parts.port !== undefined) expect(Number(parts.port)).toBe(driver.port);
    else expect([undefined, 1433]).toContain(driver.port);
  });
});
