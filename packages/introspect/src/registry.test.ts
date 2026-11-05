import { describe, expect, it, vi } from "vitest";
import {
  connectorPackageMissingMessage,
  createConnectorRegistry,
  type ConnectorProviderAdapter,
  type ConnectorConfig,
  type ConnectorConnectionRequest,
  type ConnectorConnectionResult,
} from "./registry.js";
import { runtimeIntrospectionString } from "./kit/provider.js";

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

    const config: ConnectorConfig = {
      provider: "mysql",
      url: "mysql://localhost/db",
      fromExport: "/path/to/export",
      filters: { schemas: ["public"] },
      schemaId: "my-schema",
    };
    registry.createConnector(config);

    expect(mysqlAdapter.createConnector).toHaveBeenCalledWith(config);
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
    async (provider) => {
      const registry = createConnectorRegistry([]);
      expect(() => registry.createConnector({ provider })).toThrow(`Install @askdb/${provider}`);
      await expect(registry.load(provider)).rejects.toThrow(`Install @askdb/${provider}`);
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

// A lazy entry stands for an engine package the host may not have installed
// (`@askdb/prisma` is an optional peer of the CLI and Studio): the registry
// knows its id up front and imports the adapter only when it is selected.
describe("createConnectorRegistry — lazy entries", () => {
  const lazy = (adapter: ConnectorProviderAdapter) => ({
    provider: adapter.provider,
    load: vi.fn(async () => adapter),
  });

  it("lists a lazy entry without loading it, and dispatches to its adapter once loaded", async () => {
    const prisma = makeAdapter("prisma");
    const entry = lazy(prisma);
    const registry = createConnectorRegistry([makeAdapter("postgres"), entry]);

    expect(registry.providers()).toEqual(["postgres", "prisma"]);
    expect(registry.hasProvider("prisma")).toBe(true);
    expect(entry.load).not.toHaveBeenCalled();

    expect(await registry.load("prisma")).toBe(prisma);
    registry.createConnector({ provider: "prisma", schemaPath: "./prisma" });
    expect(prisma.createConnector).toHaveBeenCalledWith({ provider: "prisma", schemaPath: "./prisma" });
  });

  it("calls the entry's load once across repeated and concurrent loads", async () => {
    const entry = lazy(makeAdapter("prisma"));
    const registry = createConnectorRegistry([entry]);

    const [first, second] = await Promise.all([registry.load("prisma"), registry.load("prisma")]);
    const third = await registry.load("prisma");

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(entry.load).toHaveBeenCalledTimes(1);
  });

  it("passes a failed load's error through unchanged and retries on the next call", async () => {
    const prisma = makeAdapter("prisma");
    const missing = Object.assign(new Error("Cannot find package '@askdb/prisma'"), { code: "ERR_MODULE_NOT_FOUND" });
    const load = vi.fn<() => Promise<ConnectorProviderAdapter>>().mockRejectedValueOnce(missing).mockResolvedValueOnce(prisma);
    const registry = createConnectorRegistry([{ provider: "prisma", load }]);

    await expect(registry.load("prisma")).rejects.toBe(missing);
    // e.g. the user installed the package while a long-running host (Studio) kept going.
    await expect(registry.load("prisma")).resolves.toBe(prisma);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects a loaded adapter whose provider differs from the entry's, and does not use it", async () => {
    const registry = createConnectorRegistry([{ provider: "prisma", load: async () => makeAdapter("postgres") }]);

    await expect(registry.load("prisma")).rejects.toThrow(
      'Connector provider adapter mismatch: the lazy entry "prisma" loaded adapter "postgres".',
    );
    expect(() => registry.createConnector({ provider: "prisma" })).toThrow(/is not loaded yet/);
  });

  // Fail closed: a host that forgot load() must not get a generic label, "no
  // templates", or "not registered" for an engine it did register.
  it.each<[string, (registry: ReturnType<typeof createConnectorRegistry>) => unknown]>([
    ["createConnector", (r) => r.createConnector({ provider: "prisma" })],
    ["resolveConnection", (r) => r.resolveConnection("prisma", { runtime: { introspection: {} } })],
    ["getTemplates", (r) => r.getTemplates("prisma")],
    ["connectionLabel", (r) => r.connectionLabel("prisma", { schemaPath: "./prisma" })],
  ])("%s on a lazy entry that is not loaded yet throws naming registry.load()", (_name, call) => {
    const entry = lazy({ ...makeAdapter("prisma"), getTemplates: () => undefined, connectionLabelParts: () => ({ file: "x" }) });
    const registry = createConnectorRegistry([entry]);

    expect(() => call(registry)).toThrow('Connector provider "prisma" is not loaded yet. Call `await registry.load("prisma")` first.');
    expect(entry.load).not.toHaveBeenCalled();
  });
});

describe("connectorPackageMissingMessage", () => {
  // The CLI and Studio show it for a missing `@askdb/prisma`. On pnpm 11 its install
  // exits 1 unless the `@prisma/engines` build is approved (#259), so the hint approves it.
  it("renders the first-party install hint, with the build approvals the package needs", () => {
    expect(
      connectorPackageMissingMessage({ provider: "prisma", packageName: "@askdb/prisma", allowBuilds: ["@prisma/engines"] }),
    ).toBe(
      'Engine "prisma" needs the optional peer dependency `@askdb/prisma`. ' +
        "Install it in your project (e.g. `pnpm add --allow-build=@prisma/engines @askdb/prisma`) " +
        "or include it in a one-off command (`npx -p askdb -p @askdb/prisma askdb ...`).",
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
