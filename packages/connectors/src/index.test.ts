import * as introspect from "@askdb/introspect";
import * as kit from "@askdb/introspect/kit";
import { describe, expect, it } from "vitest";
import * as connectors from "./index.js";

describe("@askdb/connectors compatibility shim", () => {
  it("re-exports the @askdb/introspect registry unchanged", () => {
    expect(connectors.createConnectorRegistry).toBe(introspect.createConnectorRegistry);
    expect(connectors.connectorProviderMissingMessage).toBe(introspect.connectorProviderMissingMessage);
    expect(connectors.CONNECTOR_PROVIDERS).toBe(introspect.BUILT_IN_CONNECTOR_PROVIDERS);
    expect([...connectors.CONNECTOR_PROVIDERS]).toEqual(["postgres", "prisma", "mysql", "sqlite", "sqlserver"]);
  });

  it("re-exports the @askdb/introspect/kit connection-label helpers unchanged", () => {
    expect(connectors.formatConnectionLabel).toBe(kit.formatConnectionLabel);
    expect(connectors.parseConnectionUrl).toBe(kit.parseConnectionUrl);
  });

  it("still builds a working registry through the old import path", () => {
    const registry = connectors.createConnectorRegistry([
      {
        provider: "postgres",
        createConnector: () => ({ connector: { describe: async () => ({}) as never }, input: {}, mode: "live" }),
      },
    ]);
    expect(registry.hasProvider("postgres")).toBe(true);
    expect(() => registry.createConnector({ provider: "mysql" })).toThrow(/Install @askdb\/mysql/);
  });
});
