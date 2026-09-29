import { describe, expect, it } from "vitest";
import { resolveConnectionInput } from "./sqlserver.js";

// Helper to confirm the result is a plain string (ADO.NET pass-through)
function asString(result: unknown): string {
  if (typeof result !== "string") throw new Error(`Expected string, got ${JSON.stringify(result)}`);
  return result;
}

describe("resolveConnectionInput", () => {
  describe("ADO.NET string normalisation", () => {
    it("passes through unchanged when no affected keys are present", () => {
      const cs = "Server=db.example.com,1433;Database=AppCatalog;User Id=appuser;Password=Str0ngP4ss;";
      expect(resolveConnectionInput(cs)).toBe(cs);
    });

    it("normalises 'Trust Server Certificate' to 'TrustServerCertificate'", () => {
      const cs = "Server=db.example.com,1433;Database=AppCatalog;User ID=appuser;Password=Str0ngP4ss;Encrypt=True;Trust Server Certificate=True;";
      const result = asString(resolveConnectionInput(cs));
      expect(result).toContain("TrustServerCertificate=True");
      expect(result).not.toMatch(/Trust Server Certificate/i);
    });

    it("normalises 'Application Intent' to 'ApplicationIntent'", () => {
      const result = asString(resolveConnectionInput("Server=db.example.com;Application Intent=ReadWrite;"));
      expect(result).toContain("ApplicationIntent=ReadWrite");
    });

    it("handles the full VS Code mssql-style ADO.NET string", () => {
      const cs =
        "Data Source=db.example.com,1433;Initial Catalog=AppCatalog;User ID=appuser;Password=Str0ngP4ss;Pooling=False;" +
        "Connect Timeout=30;Encrypt=True;Trust Server Certificate=True;" +
        "Authentication=SqlPassword;Application Name=vscode-mssql;" +
        "Application Intent=ReadWrite;Command Timeout=30";
      const result = asString(resolveConnectionInput(cs));
      expect(result).toContain("TrustServerCertificate=True");
      expect(result).toContain("ApplicationIntent=ReadWrite");
    });

    it("is case-insensitive for the key name", () => {
      const result = asString(resolveConnectionInput("Server=db.example.com;trust server certificate=true;"));
      expect(result.toLowerCase()).toContain("trustservercertificate=true");
    });
  });

  it("passes unknown scheme strings through unchanged", () => {
    const cs = "postgres://appuser:Str0ngP4ss@db.example.com/AppCatalog";
    expect(resolveConnectionInput(cs)).toBe(cs);
  });

  describe("mssql:// URL format", () => {
    it("parses standard mssql:// URL", () => {
      const result = resolveConnectionInput("mssql://appuser:Str0ngP4ss@db.example.com:1433/AppCatalog");
      expect(result).toEqual({
        server: "db.example.com",
        port: 1433,
        database: "AppCatalog",
        user: "appuser",
        password: "Str0ngP4ss",
        options: {},
      });
    });

    it("handles mssql:// URL without port", () => {
      const result = resolveConnectionInput("mssql://appuser:Str0ngP4ss@prod.database.windows.net/AppCatalog");
      expect(result).toMatchObject({
        server: "prod.database.windows.net",
        database: "AppCatalog",
        user: "appuser",
        password: "Str0ngP4ss",
      });
      expect((result as { port?: number }).port).toBeUndefined();
    });

    it("parses encrypt and trustServerCertificate query params", () => {
      const result = resolveConnectionInput("mssql://appuser:Str0ngP4ss@db.example.com/AppCatalog?encrypt=true&trustServerCertificate=true");
      expect(result).toMatchObject({
        server: "db.example.com",
        options: { encrypt: true, trustServerCertificate: true },
      });
    });

    it("treats encrypt=false correctly", () => {
      const result = resolveConnectionInput("mssql://appuser:Str0ngP4ss@db.example.com/AppCatalog?encrypt=false");
      expect((result as { options?: { encrypt?: boolean } }).options?.encrypt).toBe(false);
    });

    it("handles URL-encoded characters in password", () => {
      const result = resolveConnectionInput("mssql://appuser:p%40ssw0rd@db.example.com/AppCatalog");
      expect((result as { password?: string }).password).toBe("p@ssw0rd");
    });

    it("throws when hostname is missing", () => {
      expect(() => resolveConnectionInput("mssql:///db")).toThrow("Cannot parse server hostname");
    });
  });

  describe("sqlserver:// Prisma URL format", () => {
    it("parses Prisma-style sqlserver:// URL", () => {
      const result = resolveConnectionInput(
        "sqlserver://db.example.com:1433;database=AppCatalog;user=appuser;password=Str0ngP4ss;encrypt=true",
      );
      expect(result).toEqual({
        server: "db.example.com",
        port: 1433,
        database: "AppCatalog",
        user: "appuser",
        password: "Str0ngP4ss",
        options: { encrypt: true },
      });
    });

    it("parses trustServerCertificate (case-insensitive key)", () => {
      const result = resolveConnectionInput(
        "sqlserver://db.example.com:1433;database=AppCatalog;user=appuser;password=Str0ngP4ss;trustServerCertificate=true",
      );
      expect((result as { options?: { trustServerCertificate?: boolean } }).options?.trustServerCertificate).toBe(true);
    });

    it("handles sqlserver:// URL without port", () => {
      const result = resolveConnectionInput("sqlserver://db.example.com;database=AppCatalog;user=appuser;password=Str0ngP4ss");
      expect((result as { server: string }).server).toBe("db.example.com");
      expect((result as { port?: number }).port).toBeUndefined();
    });

    it("throws when server is missing", () => {
      expect(() => resolveConnectionInput("sqlserver://;database=db")).toThrow("Cannot parse server hostname");
    });

    // Prisma's grammar (prisma/connection-string, src/jdbc.rs): special characters
    // go inside {…}, read verbatim up to the first }.
    it("reads Prisma's documented {…} escaping (the doc example yields the password Pass:Word;)", () => {
      expect(
        resolveConnectionInput("sqlserver://host:1433;user={MyServer/User};password={Pass:Word;};database=db"),
      ).toEqual({
        server: "host",
        port: 1433,
        database: "db",
        user: "MyServer/User",
        password: "Pass:Word;",
        options: {},
      });
    });

    it("joins braced and plain runs as Prisma does ({abc;}}45} is abc;}45})", () => {
      const result = resolveConnectionInput("sqlserver://h:4200;User ID=musti;Password={abc;}}45}") as {
        password?: string;
      };
      expect(result.password).toBe("abc;}45}");
    });

    it("keeps a ;database= inside a braced value out of the database", () => {
      const result = resolveConnectionInput("sqlserver://h:1433;database=app;user=sa;password={S3c;database=ret;}") as {
        database?: string;
        password?: string;
      };
      expect(result).toMatchObject({ database: "app", password: "S3c;database=ret;" });
    });

    it("honours Prisma's aliases and a named instance", () => {
      expect(resolveConnectionInput("sqlserver://h\\SQLEXPRESS:1433;initial catalog=app;uid=sa;pwd=pw")).toEqual({
        server: "h",
        port: 1433,
        database: "app",
        user: "sa",
        password: "pw",
        options: { instanceName: "SQLEXPRESS" },
      });
    });

    it.each([
      ["an unclosed {", "sqlserver://h;password={S3cret", "is never closed"],
      ["a quoted value holding ;", 'sqlserver://h;user=sa;password="S3c;database=ret;"', "must be joined to its value by ="],
      ["an unescaped = in a value", "sqlserver://h;password=a=b", "unexpected"],
      ["a segment that isn't key=value", "sqlserver://h;password=ab;cd;database=app", "must be joined to its value by ="],
      ["an empty segment", "sqlserver://h;password=p;;database=leak", "empty property key"],
      ["a non-ASCII character", "sqlserver://h;password=pässword", "non-ASCII"],
      ["two aliases of one setting", "sqlserver://h;database=a;initial catalog=b", "set only one of database, initial catalog"],
      ["a non-numeric port", "sqlserver://sa:se;cret@h", "the port is not a number"],
    ])("rejects %s, as Prisma does", (_name, input, message) => {
      expect(() => resolveConnectionInput(input)).toThrow(message);
    });
  });
});
