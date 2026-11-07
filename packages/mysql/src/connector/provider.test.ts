import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type CatalogQueryRunner, type ConnectorConnectionRequest } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
import { MYSQL_CATALOG_SQL } from "./describe.js";
import { mysqlConnectorProvider } from "./provider.js";

// Through the registry, which adds the label built from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([mysqlConnectorProvider]);
const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("mysql", request);
const runtime = (mysqlDatabaseUrl?: string) => ({ introspection: { provider: "mysql", mysqlDatabaseUrl } });

describe("mysqlConnectorProvider", () => {
  it("resolves the configured URL and labels it by host and database only", () => {
    expect(resolve({ runtime: runtime("mysql://root:S3cret@db:3306/shop") })).toEqual({
      ok: true,
      connection: { url: "mysql://root:S3cret@db:3306/shop" },
      sourceLabel: "mysql://db:3306/shop",
    });
  });

  it("phrases the missing-connection error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error:
        "Provide --url <mysql-url> (or set introspection.provider: \"mysql\" and introspection.providerConfig.mysql.databaseUrl in askdb.config).",
    });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({
      ok: false,
      error:
        "No MySQL connection configured. Set introspection.providerConfig.mysql.databaseUrl in askdb.config.ts (bound to an env var in .env).",
    });
  });

  it("rejects --from-export next to a configured connection with the engine's own message", () => {
    expect(resolve({ explicit: { fromExport: "./bundle" }, runtime: runtime("mysql://root:S3cret@db:3306/shop") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got mysql).",
    });
  });
});

describe("mysqlConnectorProvider.createConnector", () => {
  // Swap the driver-backed runner for an empty catalog, so nothing connects.
  const emptyCatalog: CatalogQueryRunner = async (sql) => (sql === MYSQL_CATALOG_SQL.current_database
    ? { columns: ["database_name"], rows: [["shop"]] }
    : { columns: [], rows: [] });

  it.each([
    ["shop", "shop"],
    [undefined, "introspected"],
  ])("turns config.schemaId %s into SqlSchema.schemaId %s", async (schemaId, expected) => {
    const { connector, input } = mysqlConnectorProvider.createConnector({ provider: "mysql", url: "mysql://db:3306/shop", schemaId });
    const result = await connector.describe({ ...(input as LiveCatalogInput), runner: emptyCatalog });
    expect(result.schema.schemaId).toBe(expected);
  });
});
