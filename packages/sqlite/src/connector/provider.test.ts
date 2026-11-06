import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type CatalogQueryRunner, type ConnectorConnectionRequest } from "@askdb/introspect";
import type { LiveCatalogInput } from "@askdb/introspect/kit";
import { sqliteConnectorProvider } from "./provider.js";

// Through the registry, which adds the label built from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([sqliteConnectorProvider]);
const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("sqlite", request);
const runtime = (sqliteFile?: string) => ({ introspection: { provider: "sqlite", sqliteFile } });

describe("sqliteConnectorProvider", () => {
  it("passes the configured file path through unchanged", () => {
    expect(resolve({ runtime: runtime("./data/app.db") })).toEqual({
      ok: true,
      connection: { url: "./data/app.db" },
      sourceLabel: "./data/app.db",
    });
  });

  it("phrases the missing-file error per surface", () => {
    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({
      ok: false,
      error:
        "Provide --url <path-to-sqlite-file> (or set introspection.provider: \"sqlite\" and introspection.providerConfig.sqlite.file in askdb.config).",
    });
    expect(resolve({ runtime: runtime() })).toEqual({
      ok: false,
      error: "No SQLite file configured. Set introspection.providerConfig.sqlite.file in askdb.config.ts.",
    });
  });

  it("rejects --from-export next to a configured connection with the engine's own message", () => {
    expect(resolve({ explicit: { fromExport: "./bundle" }, runtime: runtime("./app.db") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got sqlite).",
    });
  });
});

describe("sqliteConnectorProvider.createConnector", () => {
  // Swap the driver-backed runner for an empty catalog, so nothing connects.
  const emptyCatalog: CatalogQueryRunner = async () => ({ columns: [], rows: [] });

  it.each([
    ["shop", "shop"],
    [undefined, "introspected"],
  ])("turns config.schemaId %s into SqlSchema.schemaId %s", async (schemaId, expected) => {
    const { connector, input } = sqliteConnectorProvider.createConnector({ provider: "sqlite", url: "./app.db", schemaId });
    const result = await connector.describe({ ...(input as LiveCatalogInput), runner: emptyCatalog });
    expect(result.schema.schemaId).toBe(expected);
  });
});
