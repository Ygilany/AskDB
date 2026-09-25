import { describe, expect, it, vi } from "vitest";
import {
  createConnectorRegistry,
  runtimeIntrospectionString,
  type ConnectorProviderAdapter,
  type ConnectorConfig,
  type ConnectorConnectionRequest,
  type ConnectorConnectionResolution,
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

describe("createConnectorRegistry — open provider ids (third-party engines)", () => {
  const runtime = { introspection: { provider: "acme", acmeUrl: "acme://configured" } };

  it("accepts and dispatches a custom provider id", () => {
    const acme = makeAdapter("acme");
    const registry = createConnectorRegistry([makeAdapter("postgres"), acme]);

    expect(registry.hasProvider("acme")).toBe(true);
    expect(registry.providers()).toEqual(["postgres", "acme"]);
    registry.createConnector({ provider: "acme", url: "acme://db" });
    expect(acme.createConnector).toHaveBeenCalledWith({ provider: "acme", url: "acme://db" });
  });

  it("accepts a custom provider id in the object-map form", () => {
    const registry = createConnectorRegistry({ acme: makeAdapter("acme") });
    expect(registry.hasProvider("acme")).toBe(true);
  });

  it("points unregistered custom providers at their own package", () => {
    const registry = createConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "acme" })).toThrow(
      'Connector provider "acme" is not registered. Install the package that provides it',
    );
  });

  it("resolveConnection delegates to the adapter hook with the full request", () => {
    const resolveConnection = vi.fn(
      (request: ConnectorConnectionRequest): ConnectorConnectionResolution => ({
        ok: true,
        connection: { url: request.explicit?.url ?? (request.runtime.introspection.acmeUrl as string) },
        sourceLabel: "acme",
      }),
    );
    const registry = createConnectorRegistry([{ ...makeAdapter("acme"), resolveConnection }]);

    const resolved = registry.resolveConnection("acme", { runtime, surface: "cli" });

    expect(resolveConnection).toHaveBeenCalledWith({ runtime, surface: "cli" });
    expect(resolved).toEqual({ ok: true, connection: { url: "acme://configured" }, sourceLabel: "acme" });
  });

  it("resolveConnection passes explicit values through when the adapter has no hook", () => {
    const registry = createConnectorRegistry([makeAdapter("acme")]);
    expect(
      registry.resolveConnection("acme", { explicit: { url: "acme://u:S3cret@h/db" }, runtime }),
    ).toEqual({ ok: true, connection: { url: "acme://u:S3cret@h/db" }, sourceLabel: "acme://u:****@h/db" });
    expect(registry.resolveConnection("acme", { runtime })).toEqual({
      ok: true,
      connection: {},
      sourceLabel: "acme",
    });
  });

  it("resolveConnection throws for unregistered providers", () => {
    expect(() => createConnectorRegistry([]).resolveConnection("acme", { runtime })).toThrow(/not registered/);
  });

  it("redactConnectionString uses the adapter's redactor, else generic redaction", () => {
    const registry = createConnectorRegistry([
      { ...makeAdapter("acme"), redactConnectionString: () => "custom" },
      makeAdapter("plain"),
    ]);
    expect(registry.redactConnectionString("acme", "acme://u:p@h")).toBe("custom");
    expect(registry.redactConnectionString("plain", "x://u:S3cret@h")).toBe("x://u:****@h");
    expect(registry.redactConnectionString("unknown", "Server=h;Password=S3cret;")).toBe(
      "Server=h;Password=****;",
    );
  });
});

describe("runtimeIntrospectionString", () => {
  it("returns non-empty strings only", () => {
    const runtime = { introspection: { a: "x", b: "", c: 3 } };
    expect(runtimeIntrospectionString(runtime, "a")).toBe("x");
    expect(runtimeIntrospectionString(runtime, "b")).toBeUndefined();
    expect(runtimeIntrospectionString(runtime, "c")).toBeUndefined();
    expect(runtimeIntrospectionString(runtime, "missing")).toBeUndefined();
  });
});
