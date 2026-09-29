import { describe, expect, it, vi } from "vitest";
import {
  createConnectorRegistry,
  type ConnectorProviderAdapter,
  type ConnectorConfig,
} from "./registry.js";

const makeAdapter = (provider: ConnectorProviderAdapter["provider"]): ConnectorProviderAdapter => ({
  provider,
  createConnector: vi.fn((config: ConnectorConfig) => ({
    connector: { describe: vi.fn() },
    input: { provider: config.provider, url: config.url },
    mode: "live",
  })),
});

describe("createConnectorRegistry", () => {
  it("dispatches to the correct adapter by provider (array form)", () => {
    const pgAdapter = makeAdapter("postgres");
    const registry = createConnectorRegistry([pgAdapter]);

    const result = registry.createConnector({ provider: "postgres", url: "postgres://localhost/db" });

    expect(pgAdapter.createConnector).toHaveBeenCalledWith({
      provider: "postgres",
      url: "postgres://localhost/db",
    });
    expect(result.mode).toBe("live");
  });

  it("dispatches to the correct adapter by provider (object-map form)", () => {
    const pgAdapter = makeAdapter("postgres");
    const mysqlAdapter = makeAdapter("mysql");
    const registry = createConnectorRegistry({ postgres: pgAdapter, mysql: mysqlAdapter });

    registry.createConnector({ provider: "mysql", url: "mysql://localhost/db" });

    expect(mysqlAdapter.createConnector).toHaveBeenCalled();
    expect(pgAdapter.createConnector).not.toHaveBeenCalled();
  });

  it("hasProvider returns true for registered providers", () => {
    const registry = createConnectorRegistry([makeAdapter("postgres"), makeAdapter("prisma")]);
    expect(registry.hasProvider("postgres")).toBe(true);
    expect(registry.hasProvider("prisma")).toBe(true);
    expect(registry.hasProvider("mysql")).toBe(false);
  });

  it("throws an actionable error when a provider is not registered", () => {
    const registry = createConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "mysql", url: "mysql://localhost/db" })).toThrow(
      /Install @askdb\/mysql/,
    );
  });

  it("throws for an unregistered sqlserver provider with the right package name", () => {
    const registry = createConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "sqlserver" })).toThrow(
      /Install @askdb\/sqlserver/,
    );
  });

  it("throws for an unregistered prisma provider with the right package name", () => {
    const registry = createConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "prisma" })).toThrow(
      /Install @askdb\/prisma/,
    );
  });

  it("returns false from hasProvider when registry is empty", () => {
    const registry = createConnectorRegistry([]);
    expect(registry.hasProvider("postgres")).toBe(false);
  });

  it("rejects mismatched object-map adapters", () => {
    const pgAdapter = makeAdapter("postgres");
    expect(() => createConnectorRegistry({ mysql: pgAdapter })).toThrow(/adapter mismatch/);
  });

  it("passes all config fields through to the adapter", () => {
    const adapter = makeAdapter("postgres");
    const registry = createConnectorRegistry([adapter]);

    const config: ConnectorConfig = {
      provider: "postgres",
      url: "postgres://localhost/db",
      fromExport: "/path/to/export",
      filters: { schemas: ["public"] },
      schemaId: "my-schema",
    };
    registry.createConnector(config);

    expect(adapter.createConnector).toHaveBeenCalledWith(config);
  });

  it("getTemplates returns the bundle from an adapter that implements it", () => {
    const bundle = { engine: "postgres", version: 1, templates: [] };
    const pgAdapter: ConnectorProviderAdapter = {
      provider: "postgres",
      createConnector: vi.fn(() => ({ connector: { describe: vi.fn() }, input: {}, mode: "live" })),
      getTemplates: vi.fn(() => bundle as never),
    };
    const registry = createConnectorRegistry([pgAdapter]);

    expect(registry.getTemplates("postgres")).toBe(bundle);
    expect(pgAdapter.getTemplates).toHaveBeenCalled();
  });

  it("getTemplates returns undefined for providers that do not implement it", () => {
    const registry = createConnectorRegistry([makeAdapter("mysql")]);
    expect(registry.getTemplates("mysql")).toBeUndefined();
  });

  it("getTemplates returns undefined for providers that are not registered", () => {
    const registry = createConnectorRegistry([]);
    expect(registry.getTemplates("postgres")).toBeUndefined();
  });
});

// ADR 0011: adapters return parts, never label text, so the allowlist in
// formatConnectionLabel applies to every adapter, including a third-party one
// that hands back something unsafe.
describe("createConnectorRegistry — connectionLabel", () => {
  const url = "acme://scott:S3cret@db:1521/orcl";
  it.each<[string, ConnectorProviderAdapter["connectionLabelParts"], string]>([
    ["well-formed parts", () => ({ host: "db", port: "1521", database: "orcl" }), "postgres://db:1521/orcl"],
    ["the raw URL as the host", ({ url: raw }) => ({ host: raw }), "configured postgres connection"],
    ["a masked URL as the host", () => ({ host: "scott:****@db" }), "configured postgres connection"],
    ["the raw URL as a file", ({ url: raw }) => ({ file: raw! }), "configured postgres connection"],
    ["undefined (did not parse)", () => undefined, "configured postgres connection"],
    ["no hook", undefined, "configured postgres connection"],
  ])("builds the label from the adapter's parts: %s", (_name, connectionLabelParts, label) => {
    const registry = createConnectorRegistry([{ ...makeAdapter("postgres"), connectionLabelParts }]);
    expect(registry.connectionLabel("postgres", { url })).toBe(label);
  });

  it("labels an unregistered provider without throwing", () => {
    expect(createConnectorRegistry([]).connectionLabel("mysql", { url })).toBe("configured mysql connection");
  });
});
