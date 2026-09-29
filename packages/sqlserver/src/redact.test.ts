import { describe, expect, it } from "vitest";
import { redactConnectionString } from "./index.js";

describe("redactConnectionString (sqlserver)", () => {
  it("masks mssql:// userinfo passwords", () => {
    expect(redactConnectionString("mssql://sa:S3cret@localhost:1433/app")).toBe(
      "mssql://sa:****@localhost:1433/app",
    );
  });

  it("masks the Prisma/JDBC-style ;password= pair (previously shown verbatim in Studio)", () => {
    expect(redactConnectionString("sqlserver://host;database=db;user=sa;password=S3cret")).toBe(
      "sqlserver://host;database=db;user=sa;password=****",
    );
    expect(
      redactConnectionString("sqlserver://host:1433;database=db;user=sa;password={S3;cr&et};encrypt=true"),
    ).toBe("sqlserver://host:1433;database=db;user=sa;password=****;encrypt=true");
  });

  it("masks ADO.NET Password= and Pwd= values, including ones containing & or spaces", () => {
    expect(
      redactConnectionString("Server=tcp:host,1433;User Id=sa;Password=S3c&ret word;Trust Server Certificate=true"),
    ).toBe("Server=tcp:host,1433;User Id=sa;Password=****;Trust Server Certificate=true");
    expect(redactConnectionString("Data Source=host;UID=sa;PWD='a;b';")).toBe(
      "Data Source=host;UID=sa;PWD=****;",
    );
  });

  it.each([" ", "\t", "\n"])("masks mssql:// and Prisma-form passwords after leading %j", (lead) => {
    expect(redactConnectionString(`${lead}mssql://sa:S3cret@localhost:1433/app`)).toBe(
      `${lead}mssql://sa:****@localhost:1433/app`,
    );
    expect(redactConnectionString(`${lead}sqlserver://host:1433;user=sa;password=S3cret;encrypt=true`)).toBe(
      `${lead}sqlserver://host:1433;user=sa;password=****;encrypt=true`,
    );
  });

  it("masks to the end of the string when an unquoted password contains a ; (malformed, fails closed)", () => {
    expect(redactConnectionString("Server=db;User Id=sa;Password=ab;cd;Database=app")).toBe(
      "Server=db;User Id=sa;Password=****",
    );
    expect(redactConnectionString("sqlserver://db:1433;user=sa;password=ab;cd;database=app")).toBe(
      "sqlserver://db:1433;user=sa;password=****",
    );
  });

  it("reads the Prisma form's text after the first ; as key=value pairs, never as URL userinfo", () => {
    // An @ in the password was taken as the userinfo end: the port's `:` started
    // the mask and the rest of the password stayed visible.
    expect(redactConnectionString("sqlserver://host:1433;database=db;user=sa;password=p@ssw0rd")).toBe(
      "sqlserver://host:1433;database=db;user=sa;password=****",
    );
    expect(redactConnectionString("sqlserver://host:1433;database=db;user=sa;password={p@ss;w0rd}")).toBe(
      "sqlserver://host:1433;database=db;user=sa;password=****",
    );
    expect(redactConnectionString("sqlserver://host:1433;user=admin@corp;password=S3cret")).toBe(
      "sqlserver://host:1433;user=admin@corp;password=****",
    );
  });
});
