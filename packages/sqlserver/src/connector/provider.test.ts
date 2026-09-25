import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type ConnectorConnectionRequest } from "@askdb/introspect";
import { sqlServerConnectorProvider } from "./provider.js";

// Through the registry, which adds the label built from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([sqlServerConnectorProvider]);
const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("sqlserver", request);
const runtime = (sqlserverDatabaseUrl?: string) => ({ introspection: { provider: "sqlserver", sqlserverDatabaseUrl } });

describe("sqlServerConnectorProvider", () => {
  it("resolves the configured connection string and labels it by host and database only", () => {
    expect(resolve({ runtime: runtime("sqlserver://host;database=db;user=sa;password=S3cret") })).toEqual({
      ok: true,
      connection: { url: "sqlserver://host;database=db;user=sa;password=S3cret" },
      sourceLabel: "sqlserver://host/db",
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

  it("createConnector requires a URL", () => {
    expect(() => sqlServerConnectorProvider.createConnector({ provider: "sqlserver" })).toThrow(
      "SQL Server connector requires a connection URL (config.url).",
    );
  });
});
