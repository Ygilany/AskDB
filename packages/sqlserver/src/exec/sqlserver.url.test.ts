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

    // Prisma's {…} escaping (Prisma's SQL Server docs; prisma/connection-string
    // src/jdbc.rs): a { opens a span read verbatim up to the first }.
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

    it("throws for a { that is never closed", () => {
      expect(() => resolveConnectionInput("sqlserver://h;password={S3cret")).toThrow("is never closed");
    });
  });
});

// The Prisma-form parser before #189 (packages/sqlserver/src/exec/sqlserver.ts
// on main), copied as a fixture: every string it read correctly must still
// connect with the same values.
function legacyParsePrismaSqlServerUrl(connectionString: string) {
  const withoutScheme = connectionString.slice("sqlserver://".length);
  const firstSemiIdx = withoutScheme.indexOf(";");
  const hostPart = firstSemiIdx === -1 ? withoutScheme : withoutScheme.slice(0, firstSemiIdx);
  const paramsPart = firstSemiIdx === -1 ? "" : withoutScheme.slice(firstSemiIdx + 1);

  const colonIdx = hostPart.lastIndexOf(":");
  const server = colonIdx === -1 ? hostPart : hostPart.slice(0, colonIdx);
  const portStr = colonIdx === -1 ? undefined : hostPart.slice(colonIdx + 1);
  const port = portStr ? parseInt(portStr, 10) : undefined;

  if (!server) throw new Error("Cannot parse server hostname from Prisma-style SQL Server URL.");

  const params: Record<string, string> = {};
  for (const part of paramsPart.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim().toLowerCase();
    const value = part.slice(eqIdx + 1).trim();
    if (key && value) params[key] = value;
  }

  return {
    server,
    ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
    ...(params["database"] ? { database: params["database"] } : {}),
    ...(params["user"] ? { user: params["user"] } : {}),
    ...(params["password"] ? { password: params["password"] } : {}),
    options: {
      ...(params["encrypt"] !== undefined ? { encrypt: params["encrypt"].toLowerCase() === "true" } : {}),
      ...(params["trustservercertificate"] !== undefined
        ? { trustServerCertificate: params["trustservercertificate"].toLowerCase() === "true" }
        : {}),
    },
  };
}

describe("sqlserver:// backward compatibility with the parser before #189", () => {
  it.each([
    "sqlserver://db.example.com:1433;database=AppCatalog;user=appuser;password=Str0ngP4ss;encrypt=true",
    "sqlserver://db.example.com;database=AppCatalog;user=appuser;password=Str0ngP4ss",
    "sqlserver://db:1433;database=app;user=sa;password=S3cret;trustServerCertificate=true;",
    // An unbraced = in a value: the key ends at the first =.
    "sqlserver://h;user=sa;password=a=b;database=app",
    "sqlserver://h;user=sa;password=abc==",
    // Non-ASCII.
    "sqlserver://h;user=sa;password=pässwörd€;database=datenbänk",
    // Whitespace around keys and values.
    "sqlserver://h:1433; database = app ;user = sa; password = S3 cret ;",
    // An unbraced ; inside a value (ambiguous; the old reading is kept, the label falls back).
    "sqlserver://h;user=sa;password=ab;cd;database=app",
    "sqlserver://h;password=p;;database=leak",
    // Quotes are not escapes.
    'sqlserver://h;user=sa;password="S3c;database=ret;"',
    "sqlserver://h;user=sa;password='S3c'",
    // A lone } is an ordinary character.
    "sqlserver://h;user=sa;password=ab}cd",
    // Repeated keys: the last one wins.
    "sqlserver://h;database=a;database=b;DATABASE=c",
    // Ports the old parser read leniently, IPv6, a named instance, and other hosts.
    "sqlserver://h:14x3;database=app",
    "sqlserver://h:abc;database=app",
    "sqlserver://[::1]:1433;database=app",
    "sqlserver://h\\SQLEXPRESS:1433;database=app",
    "sqlserver:// h:1433;database=app",
    "sqlserver://h;user=admin@corp;password=S3cret",
    // `initial catalog` is still ignored, as before.
    "sqlserver://h;initial catalog=app;user=sa;password=S3cret",
    // Empty keys and values are skipped.
    "sqlserver://h;=x;user=;password=S3cret",
    // An alias next to its canonical key: the canonical key wins, as when aliases were ignored.
    "sqlserver://h;user=sa;uid=other;password=x",
    "sqlserver://h;user=sa;password=a;pwd=b",
    "sqlserver://h;uid=other;user=sa;pwd=b;password=a",
  ])("reads %s exactly as before", (input) => {
    expect(resolveConnectionInput(input)).toEqual(legacyParsePrismaSqlServerUrl(input));
  });

  // The only strings that connect differently: the old reading couldn't log in.
  it.each([
    [
      "Prisma's {…} escape: the old parser kept the braces and cut the value at the first ;",
      "sqlserver://h;user={MyServer/User};password={Pass:Word;};database=db",
      { user: "{MyServer/User}", password: "{Pass:Word" },
      { user: "MyServer/User", password: "Pass:Word;" },
    ],
    [
      "Prisma's pwd alias: the old parser dropped it, so there was no password",
      "sqlserver://h;user=sa;pwd=S3cret",
      { user: "sa", password: undefined },
      { user: "sa", password: "S3cret" },
    ],
    [
      "Prisma's uid and username aliases: the old parser dropped them, so there was no user",
      "sqlserver://h;uid=sa;password=S3cret",
      { user: undefined, password: "S3cret" },
      { user: "sa", password: "S3cret" },
    ],
  ])("%s", (_reason, input, before, after) => {
    const old = legacyParsePrismaSqlServerUrl(input) as { user?: string; password?: string };
    const now = resolveConnectionInput(input) as { user?: string; password?: string };
    expect({ user: old.user, password: old.password }).toEqual(before);
    expect({ user: now.user, password: now.password }).toEqual(after);
  });
});

// Values holding a literal { or }: before #189 braces were plain characters; now
// a { opens a Prisma escape (the maintainer is deciding which reading to keep).
// Each row records the old reading, whether that reading could ever have been
// the value the user meant, and the reading now, which is also Prisma's own
// (prisma/connection-string src/jdbc.rs). `throws` means an unclosed {.
describe("sqlserver:// values with braces: the old reading vs Prisma's", () => {
  it.each<[input: string, field: "password" | "database", old: string, oldCouldWork: boolean, now: string]>([
    ["sqlserver://h;user=sa;password={abc}", "password", "{abc}", true, "abc"],
    ["sqlserver://h;user=sa;password=a{b}c;database=app", "password", "a{b}c", true, "abc"],
    ["sqlserver://h;user=sa;password=ab{cd", "password", "ab{cd", true, "throws"],
    ["sqlserver://h;user=sa;password=}{", "password", "}{", true, "throws"],
    // Prisma's doc example. The old parser split at the ; inside the braces and
    // dropped the `}` segment, so it sent `{Pass:Word`: neither the braced value
    // (`Pass:Word;`) nor the literal text (`{Pass:Word;}`).
    ["sqlserver://h;user=sa;password={Pass:Word;}", "password", "{Pass:Word", false, "Pass:Word;"],
    ["sqlserver://h;user=sa;password={Pass:Word}", "password", "{Pass:Word}", true, "Pass:Word"],
    ["sqlserver://h;user=sa;password=x;database={app}", "database", "{app}", true, "app"],
  ])("%s (%s): before %s (could have worked: %s), now %s", (input, field, old, _oldCouldWork, now) => {
    expect((legacyParsePrismaSqlServerUrl(input) as Record<string, unknown>)[field]).toBe(old);
    if (now === "throws") {
      expect(() => resolveConnectionInput(input)).toThrow("is never closed");
    } else {
      expect((resolveConnectionInput(input) as Record<string, unknown>)[field]).toBe(now);
    }
  });
});
