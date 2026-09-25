import { describe, expect, it } from "vitest";
import { sqlServerConnectorProvider } from "./provider.js";

const resolve = sqlServerConnectorProvider.resolveConnection!;
const runtime = (sqlserverDatabaseUrl?: string) => ({ introspection: { provider: "sqlserver", sqlserverDatabaseUrl } });

describe("sqlServerConnectorProvider", () => {
  it("resolves the configured connection string and redacts the label", () => {
    expect(resolve({ runtime: runtime("sqlserver://host;database=db;user=sa;password=S3cret") })).toEqual({
      ok: true,
      connection: { url: "sqlserver://host;database=db;user=sa;password=S3cret" },
      sourceLabel: "sqlserver://host;database=db;user=sa;password=****",
    });
  });

  it("phrases the missing-connection error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error:
        "Provide --url <sqlserver-url> (or set introspection.providerConfig.sqlserver.databaseUrl / ASKDB_INTROSPECT_SQLSERVER_URL / DATABASE_URL).",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No SQL Server connection configured. Set introspection.providerConfig.sqlserver.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });

  it("redacts ADO.NET strings through the registry hook", () => {
    expect(sqlServerConnectorProvider.redactConnectionString!("Server=h;User Id=sa;Password=S3cret;")).toBe(
      "Server=h;User Id=sa;Password=****;",
    );
  });

  it("createConnector requires a URL", () => {
    expect(() => sqlServerConnectorProvider.createConnector({ provider: "sqlserver" })).toThrow(
      "SQL Server connector requires a connection URL (config.url).",
    );
  });
});
