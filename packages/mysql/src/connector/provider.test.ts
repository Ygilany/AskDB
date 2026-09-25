import { describe, expect, it } from "vitest";
import { mysqlConnectorProvider } from "./provider.js";

const resolve = mysqlConnectorProvider.resolveConnection!;
const runtime = (mysqlDatabaseUrl?: string) => ({ introspection: { provider: "mysql", mysqlDatabaseUrl } });

describe("mysqlConnectorProvider", () => {
  it("resolves the configured URL, lets --url win, and redacts the label", () => {
    expect(resolve({ runtime: runtime("mysql://root:S3cret@db:3306/shop") })).toEqual({
      ok: true,
      connection: { url: "mysql://root:S3cret@db:3306/shop" },
      sourceLabel: "mysql://root:****@db:3306/shop",
    });
    const flag = resolve({ explicit: { url: "mysql://flag/db" }, runtime: runtime("mysql://config/db") });
    expect(flag.ok && flag.connection.url).toBe("mysql://flag/db");
  });

  it("phrases the missing-connection error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error:
        "Provide --url <mysql-url> (or set introspection.providerConfig.mysql.databaseUrl / ASKDB_INTROSPECT_MYSQL_URL / DATABASE_URL).",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No MySQL connection configured. Set introspection.providerConfig.mysql.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });

  it("rejects --from-export", () => {
    expect(resolve({ explicit: { fromExport: "./b" }, runtime: runtime("mysql://h/db") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got mysql).",
    });
  });

  it("createConnector requires a URL and builds a live input", () => {
    expect(() => mysqlConnectorProvider.createConnector({ provider: "mysql" })).toThrow(
      "MySQL connector requires a connection URL (config.url).",
    );
    const result = mysqlConnectorProvider.createConnector({ provider: "mysql", url: "mysql://h/db" });
    expect(result.mode).toBe("live");
    expect((result.input as { mode: string }).mode).toBe("live");
  });
});
