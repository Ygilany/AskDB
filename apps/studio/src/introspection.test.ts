import { describe, expect, it } from "vitest";
import { redactUrl } from "./introspection.js";

describe("redactUrl — Studio introspection source label", () => {
  it("masks the password in the Prisma/JDBC-style SQL Server URL (was shown verbatim)", () => {
    const label = redactUrl("sqlserver", "sqlserver://host;database=db;user=sa;password=S3cret");
    expect(label).not.toContain("S3cret");
    expect(label).toBe("sqlserver://host;database=db;user=sa;password=****");
  });

  it("masks ADO.NET Password=/Pwd= values", () => {
    expect(redactUrl("sqlserver", "Server=h;User Id=sa;Password=S3cret;")).toBe(
      "Server=h;User Id=sa;Password=****;",
    );
    expect(redactUrl("sqlserver", "Server=h;Uid=sa;Pwd=S3cret;")).toBe("Server=h;Uid=sa;Pwd=****;");
  });

  it("masks URL userinfo passwords for postgres and mysql", () => {
    expect(redactUrl("postgres", "postgres://app:S3cret@db:5432/app")).toBe(
      "postgres://app:****@db:5432/app",
    );
    expect(redactUrl("mysql", "mysql://root:S3cret@db:3306/shop?password=S3cret")).toBe(
      "mysql://root:****@db:3306/shop?password=****",
    );
  });

  it("shows SQLite paths as-is", () => {
    expect(redactUrl("sqlite", "./data/app.db")).toBe("./data/app.db");
  });

  it("falls back to generic redaction for unknown providers", () => {
    const label = redactUrl("cockroachdb", "cockroach://u:S3cret@h/db?sslpassword=k2");
    expect(label).not.toContain("S3cret");
    expect(label).not.toContain("k2");
  });
});
