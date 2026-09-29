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

  it("never echoes a password that contains @ in a JDBC-style URL", () => {
    const out = redactConnectionString("sqlserver://host:1433;user=sa;password=S3c@ret");
    expect(out).not.toContain("S3c");
  });
});
