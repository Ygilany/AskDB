import { describe, expect, it } from "vitest";
import {
  isSecretConnectionKey,
  redactConnectionStringGeneric,
  redactSecretKeyValues,
  redactUrlUserinfo,
} from "./redact.js";

describe("redactUrlUserinfo", () => {
  it("masks the userinfo password and keeps user, host, path and query", () => {
    expect(redactUrlUserinfo("postgres://app:S3cret@db.example.com:5432/app?sslmode=require")).toBe(
      "postgres://app:****@db.example.com:5432/app?sslmode=require",
    );
  });

  it("masks passwords containing reserved characters up to the last @ of the authority", () => {
    expect(redactUrlUserinfo("mysql://root:p@ss:w;rd@localhost/db")).toBe(
      "mysql://root:****@localhost/db",
    );
  });

  it("masks the whole password when it contains an unencoded /, ? or # (fails closed, never echoes the input)", () => {
    expect(redactUrlUserinfo("postgres://app:pa/ss@db:5432/app")).toBe("postgres://app:****@db:5432/app");
    expect(redactUrlUserinfo("postgres://app:pa#ss@db:5432/app")).toBe("postgres://app:****@db:5432/app");
    expect(redactUrlUserinfo("mysql://root:pa?ss@db:3306/shop")).toBe("mysql://root:****@db:3306/shop");
    expect(redactUrlUserinfo("mssql://sa:p@ss/w@host:1433/db")).toBe("mssql://sa:****@host:1433/db");
  });

  it("over-masks an @ in the path or query rather than guess where userinfo ends", () => {
    expect(redactUrlUserinfo("postgres://host:5432/db?application_name=a@b")).toBe("postgres://host:****@b");
  });

  it("leaves URLs without a password and non-URLs unchanged", () => {
    expect(redactUrlUserinfo("postgres://app@host/db")).toBe("postgres://app@host/db");
    expect(redactUrlUserinfo("postgres://host/db")).toBe("postgres://host/db");
    expect(redactUrlUserinfo("Server=h;Password=x;")).toBe("Server=h;Password=x;");
  });
});

describe("redactSecretKeyValues", () => {
  it("masks ADO.NET Password/Pwd values, including quoted and braced ones", () => {
    expect(redactSecretKeyValues("Server=h;User Id=sa;Password=S3cret;Database=d", { separators: ";" })).toBe(
      "Server=h;User Id=sa;Password=****;Database=d",
    );
    expect(redactSecretKeyValues("Server=h; PWD = S3cret ;", { separators: ";" })).toBe(
      "Server=h; PWD = ****;",
    );
    expect(redactSecretKeyValues("Server=h;Password={a;b}}c};Database=d", { separators: ";" })).toBe(
      "Server=h;Password=****;Database=d",
    );
    expect(redactSecretKeyValues(`Server=h;Password="a;""b";Database=d`, { separators: ";" })).toBe(
      "Server=h;Password=****;Database=d",
    );
  });

  it("masks every secret-looking key and leaves look-alikes alone", () => {
    expect(
      redactSecretKeyValues("a=1&password=x&sslpassword=y&access_token=z&api_key=k&PasswordHint=h"),
    ).toBe("a=1&password=****&sslpassword=****&access_token=****&api_key=****&PasswordHint=h");
  });

  it("masks to the end when an unquoted secret is followed by a segment that is not key=value", () => {
    expect(redactSecretKeyValues("Server=h;Pwd=ab;cd;Database=d", { separators: ";" })).toBe("Server=h;Pwd=****");
    expect(redactSecretKeyValues("host=h password=se cret dbname=d", { separators: "", whitespaceSeparated: true })).toBe(
      "host=h password=****",
    );
  });

  it("masks to the end of an unterminated quoted value", () => {
    expect(redactSecretKeyValues("Password='abc;def", { separators: ";" })).toBe("Password=****");
  });
});

describe("redactConnectionStringGeneric", () => {
  it("handles the Studio leak case (opaque-host sqlserver URL with ;password=)", () => {
    expect(redactConnectionStringGeneric("sqlserver://host;database=db;user=sa;password=S3cret")).toBe(
      "sqlserver://host;database=db;user=sa;password=****",
    );
  });

  it("over-masks rather than leaks a ;password= value containing @ after a host:port", () => {
    // Without engine knowledge the `:1433;…;password=p@` span is ambiguous; it is
    // masked together with the password instead of leaving `ssw0rd` visible.
    expect(redactConnectionStringGeneric("sqlserver://host:1433;database=db;user=sa;password=p@ssw0rd")).toBe(
      "sqlserver://host:****",
    );
  });

  it("masks URL userinfo and query secrets together", () => {
    expect(redactConnectionStringGeneric("postgres://u:p@h/db?password=q&x=1")).toBe(
      "postgres://u:****@h/db?password=****&x=1",
    );
  });

  it("over-masks rather than leaks unknown whitespace-separated forms", () => {
    const out = redactConnectionStringGeneric("host=h password=secret dbname=d");
    expect(out).not.toContain("secret");
  });
});

describe("isSecretConnectionKey", () => {
  it("matches common secret key names case-insensitively", () => {
    for (const key of ["Password", "PWD", "pass", "passwd", "sslpassword", "AccessToken", "client_secret", "API Key"]) {
      expect(isSecretConnectionKey(key)).toBe(true);
    }
    for (const key of ["User Id", "Server", "Database", "PasswordHint"]) {
      expect(isSecretConnectionKey(key)).toBe(false);
    }
  });
});
