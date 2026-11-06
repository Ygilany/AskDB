import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type CatalogQueryRunner, type ConnectorConnectionRequest } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
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
        "Provide --url <sqlserver-url> (or set introspection.provider: \"sqlserver\" and introspection.providerConfig.sqlserver.databaseUrl in askdb.config).",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No SQL Server connection configured. Set introspection.providerConfig.sqlserver.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });

  it("rejects --from-export next to a configured connection with the engine's own message", () => {
    expect(resolve({ explicit: { fromExport: "./bundle" }, runtime: runtime("mssql://sa:S3cret@db:1433/app") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got sqlserver).",
    });
  });
});

describe("sqlServerConnectorProvider.createConnector", () => {
  // Swap the driver-backed runner for an empty catalog, so nothing connects.
  const emptyCatalog: CatalogQueryRunner = async () => ({ columns: [], rows: [] });

  it.each([
    ["shop", "shop"],
    [undefined, "introspected"],
  ])("turns config.schemaId %s into SqlSchema.schemaId %s", async (schemaId, expected) => {
    const { connector, input } = sqlServerConnectorProvider.createConnector({ provider: "sqlserver", url: "mssql://db:1433/shop", schemaId });
    const result = await connector.describe({ ...(input as LiveCatalogInput), runner: emptyCatalog });
    expect(result.schema.schemaId).toBe(expected);
  });
});
