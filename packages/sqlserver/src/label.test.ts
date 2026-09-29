import { describe, expect, it } from "vitest";
import { connectionLabel } from "./label.js";

const FALLBACK = "configured sqlserver connection";

// Inputs that leaked a secret through the earlier masking redactor (review
// rounds 1-3 on #189/#195/#199) sit next to ordinary strings in all three forms
// SQL Server accepts. A label only ever holds host, port and database.
describe("connectionLabel (sqlserver)", () => {
  it.each([
    // Ordinary mssql:// URLs.
    ["mssql://sa:S3cret@localhost:1433/app", "sqlserver://localhost:1433/app"],
    ["mssql://localhost/app", "sqlserver://localhost/app"],
    // Ordinary Prisma/JDBC-style strings.
    ["sqlserver://host:1433;database=db;user=sa;password={S3;cr&et};encrypt=true", "sqlserver://host:1433/db"],
    ["sqlserver://db:1433;initial catalog=app;password='a;''b'", "sqlserver://db:1433/app"],
    // Ordinary ADO.NET strings.
    ["Server=tcp:host,1433;User Id=sa;Password=S3c&ret word;Trust Server Certificate=true", "sqlserver://host:1433"],
    ["Data Source=host;UID=sa;PWD='a;b';", "sqlserver://host"],
    ["Server=db,1433;Database=app;User Id=sa;Password=p@ss/w#rd;", "sqlserver://db:1433/app"],
    ["Server=db;Initial Catalog=app;Password={a}}b;c};", "sqlserver://db/app"],
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
    ["Server=db;User Id=sa;Password=ab;cd;Database=app", FALLBACK],
    ["sqlserver://db:1433;user=sa;password=ab;cd;database=app", FALLBACK],
    // Round 3: a quoted or braced value followed by trailing text leaked the tail.
    ["Server=db;Database=app;Password='ab'cd;", FALLBACK],
    ["Server=db;Database=app;Password={ab}cd;", FALLBACK],
    ["sqlserver://db:1433;database=app;password={ab}cd", FALLBACK],
    // Round 3: URL userinfo in the Prisma form, and JDBC, came back unchanged.
    ["sqlserver://sa:se;cret@h", FALLBACK],
    ["jdbc:sqlserver://h:1433;databaseName=app;user=sa;password=secret", FALLBACK],
    // Ambiguous: a repeated key, two server aliases, or a named instance.
    ["Server=db;Password=ab;Database=evil;Database=app", FALLBACK],
    ["Server=a;Data Source=b;Database=app", FALLBACK],
    ["Server=localhost\\SQLEXPRESS;Database=app;Password=S3cret", FALLBACK],
    ["User Id=sa;Password=S3cret", FALLBACK],
    // The Prisma form has no userinfo, so any @ falls back (including user=name@server).
    ["sqlserver://host:1433;database=db;user=admin@corp;password=S3cret", FALLBACK],
  ])("%s -> %s", (input, label) => {
    expect(connectionLabel(input)).toBe(label);
  });
});
