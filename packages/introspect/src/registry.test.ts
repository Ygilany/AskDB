import { describe, expect, it, vi } from "vitest";
import {
  createConnectorRegistry,
  runtimeIntrospectionString,
  type ConnectorProviderAdapter,
  type ConnectorConfig,
  type ConnectorConnectionRequest,
  type ConnectorConnectionResult,
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

  it.each(["mysql", "sqlserver", "prisma"])(
    "throws an actionable error naming @askdb/%s when that provider is not registered",
    (provider) => {
      const registry = createConnectorRegistry([]);
      expect(() => registry.createConnector({ provider })).toThrow(`Install @askdb/${provider}`);
    },
  );

  it("rejects mismatched object-map adapters", () => {
    const pgAdapter = makeAdapter("postgres");
    expect(() => createConnectorRegistry({ mysql: pgAdapter })).toThrow(/adapter mismatch/);
  });

  it("rejects two adapters for the same provider id instead of silently keeping the last", () => {
    expect(() => createConnectorRegistry([makeAdapter("acme"), makeAdapter("acme")])).toThrow(
      'Connector provider "acme" is registered twice.',
    );
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
    // Plain-JS adapters bypass the type: none of these may throw (the error text
    // would quote the URL) or reach the label.
    ["the raw URL string instead of parts", (({ url: raw }: { url?: string }) => raw) as never, "configured postgres connection"],
    ["{ file: undefined }", (() => ({ file: undefined })) as never, "configured postgres connection"],
    ["a non-string host", (() => ({ host: 42 })) as never, "configured postgres connection"],
    ["a URL object", (({ url: raw }: { url?: string }) => new URL(raw!)) as never, "configured postgres connection"],
    [
      "a hook that throws with the URL in its message",
      ({ url: raw }) => {
        throw new Error(`cannot parse ${raw}`);
      },
      "configured postgres connection",
    ],
    [
      "parts whose getter throws with the URL in its message",
      ({ url: raw }) =>
        ({
          get host(): string {
            throw new Error(`cannot read ${raw}`);
          },
        }) as never,
      "configured postgres connection",
    ],
    [
      "a Proxy whose trap throws with the URL in its message",
      ({ url: raw }) =>
        new Proxy({}, {
          has() {
            throw new Error(`cannot read ${raw}`);
          },
          get() {
            throw new Error(`cannot read ${raw}`);
          },
        }) as never,
      "configured postgres connection",
    ],
  ])("builds the label from the adapter's parts: %s", (_name, connectionLabelParts, label) => {
    const registry = createConnectorRegistry([{ ...makeAdapter("postgres"), connectionLabelParts }]);
    expect(registry.connectionLabel("postgres", { url })).toBe(label);
  });

  it("labels an unregistered provider without throwing", () => {
    expect(createConnectorRegistry([]).connectionLabel("mysql", { url })).toBe("configured mysql connection");
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

  it("points unregistered custom providers at their own package", () => {
    const registry = createConnectorRegistry([]);
    expect(() => registry.createConnector({ provider: "acme" })).toThrow(
      'Connector provider "acme" is not registered. Install the package that provides it',
    );
  });

  it("resolveConnection delegates to the adapter hook with the full request and labels the result from its parts", () => {
    const resolveConnection = vi.fn(
      (request: ConnectorConnectionRequest): ConnectorConnectionResult => ({
        ok: true,
        connection: { url: request.explicit?.url ?? (request.runtime.introspection.acmeUrl as string) },
      }),
    );
    const connectionLabelParts = vi.fn(() => ({ host: "configured" }));
    const registry = createConnectorRegistry([{ ...makeAdapter("acme"), resolveConnection, connectionLabelParts }]);

    const resolved = registry.resolveConnection("acme", { runtime, surface: "cli" });

    expect(resolveConnection).toHaveBeenCalledWith({ runtime, surface: "cli" });
    expect(connectionLabelParts).toHaveBeenCalledWith({ url: "acme://configured" });
    expect(resolved).toEqual({ ok: true, connection: { url: "acme://configured" }, sourceLabel: "acme://configured" });
  });

  it("resolveConnection drops blank explicit values before the adapter hook sees them", () => {
    const resolveConnection = vi.fn(
      (_request: ConnectorConnectionRequest): ConnectorConnectionResult => ({ ok: true, connection: {} }),
    );
    const registry = createConnectorRegistry([{ ...makeAdapter("acme"), resolveConnection }]);

    registry.resolveConnection("acme", {
      explicit: { url: "  ", fromExport: "", schemaPath: "\t" },
      runtime,
    });

    expect(resolveConnection).toHaveBeenCalledWith({ explicit: {}, runtime });
  });

  it("resolveConnection passes explicit values through when the adapter has no hook", () => {
    const registry = createConnectorRegistry([makeAdapter("acme")]);
    // Without the adapter's parser neither the URL nor a path is copied into the label (ADR 0011).
    expect(
      registry.resolveConnection("acme", { explicit: { url: "acme://u:S3cret@h/db" }, runtime }),
    ).toEqual({ ok: true, connection: { url: "acme://u:S3cret@h/db" }, sourceLabel: "configured acme connection" });
    expect(
      registry.resolveConnection("acme", { explicit: { schemaPath: "file:app.db?key=S3cret" }, runtime }),
    ).toEqual({ ok: true, connection: { schemaPath: "file:app.db?key=S3cret" }, sourceLabel: "configured acme connection" });
    expect(registry.resolveConnection("acme", { runtime })).toEqual({
      ok: true,
      connection: {},
      sourceLabel: "configured acme connection",
    });
  });

  it("resolveConnection throws for unregistered providers", () => {
    expect(() => createConnectorRegistry([]).resolveConnection("acme", { runtime })).toThrow(/not registered/);
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
