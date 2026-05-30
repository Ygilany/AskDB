import { describe, expect, it, vi } from "vitest";
import {
  createAskDbConnectorRegistry,
  type AskDbConnectorProviderAdapter,
  type AskDbConnectorConfig,
} from "./registry.js";

const makeAdapter = (provider: AskDbConnectorProviderAdapter["provider"]): AskDbConnectorProviderAdapter => ({
  provider,
  createConnector: vi.fn((config: AskDbConnectorConfig) => ({
    connector: { describe: vi.fn() },
    input: { provider: config.provider, url: config.url },
    mode: "live",
  })),
});

describe("createAskDbConnectorRegistry", () => {
  it("dispatches to the correct adapter by provider (array form)", () => {
    const pgAdapter = makeAdapter("postgres");
    const registry = createAskDbConnectorRegistry([pgAdapter]);

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
    const registry = createAskDbConnectorRegistry({ postgres: pgAdapter, mysql: mysqlAdapter });

    registry.createConnector({ provider: "mysql", url: "mysql://localhost/db" });

    expect(mysqlAdapter.createConnector).toHaveBeenCalled();
    expect(pgAdapter.createConnector).not.toHaveBeenCalled();
  });

  it("hasProvider returns true for registered providers", () => {
    const registry = createAskDbConnectorRegistry([makeAdapter("postgres"), makeAdapter("prisma")]);
    expect(registry.hasProvider("postgres")).toBe(true);
    expect(registry.hasProvider("prisma")).toBe(true);
    expect(registry.hasProvider("mysql")).toBe(false);
  });

  it("throws an actionable error when a provider is not registered", () => {
    const registry = createAskDbConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "mysql", url: "mysql://localhost/db" })).toThrow(
      /Install @askdb\/mysql/,
    );
  });

  it("throws for an unregistered sqlserver provider with the right package name", () => {
    const registry = createAskDbConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "sqlserver" })).toThrow(
      /Install @askdb\/sqlserver/,
    );
  });

  it("throws for an unregistered prisma provider with the right package name", () => {
    const registry = createAskDbConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "prisma" })).toThrow(
      /Install @askdb\/prisma/,
    );
  });

  it("returns undefined from hasProvider when registry is empty", () => {
    const registry = createAskDbConnectorRegistry([]);
    expect(registry.hasProvider("postgres")).toBe(false);
  });

  it("rejects mismatched object-map adapters", () => {
    const pgAdapter = makeAdapter("postgres");
    expect(() => createAskDbConnectorRegistry({ mysql: pgAdapter })).toThrow(/adapter mismatch/);
  });

  it("passes all config fields through to the adapter", () => {
    const adapter = makeAdapter("postgres");
    const registry = createAskDbConnectorRegistry([adapter]);

    const config: AskDbConnectorConfig = {
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
    const pgAdapter: AskDbConnectorProviderAdapter = {
      provider: "postgres",
      createConnector: vi.fn(() => ({ connector: { describe: vi.fn() }, input: {}, mode: "live" })),
      getTemplates: vi.fn(() => bundle as never),
    };
    const registry = createAskDbConnectorRegistry([pgAdapter]);

    expect(registry.getTemplates("postgres")).toBe(bundle);
    expect(pgAdapter.getTemplates).toHaveBeenCalled();
  });

  it("getTemplates returns undefined for providers that do not implement it", () => {
    const registry = createAskDbConnectorRegistry([makeAdapter("mysql")]);
    expect(registry.getTemplates("mysql")).toBeUndefined();
  });

  it("getTemplates returns undefined for providers that are not registered", () => {
    const registry = createAskDbConnectorRegistry([]);
    expect(registry.getTemplates("postgres")).toBeUndefined();
  });
});
