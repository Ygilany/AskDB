import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type ConnectorConnectionRequest } from "../registry.js";
import type { CatalogQueryRunner, Connector } from "../types.js";
import { defineLiveConnectorProvider, parseConnectionUrl, type LiveCatalogInput } from "./index.js";

const connector = { provider: "acme" } as unknown as Connector<LiveCatalogInput>;
const runners: string[] = [];
const adapter = defineLiveConnectorProvider({
  provider: "acme",
  displayName: "Acme",
  runtimeKey: "acmeUrl",
  connectionNoun: "a connection URL",
  missingConnection: { cli: "cli: pass --url", config: "config: set acmeUrl" },
  createConnector: () => connector,
  createRunner: (url) => {
    runners.push(url);
    return (async () => ({ columns: [], rows: [] })) as CatalogQueryRunner;
  },
  connectionLabelParts: (url) => parseConnectionUrl(url, ["acme"]),
});
// Through the registry, which builds the label from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([adapter]);
const runtime = (acmeUrl?: string) => ({ introspection: { provider: "acme", acmeUrl } });

describe("defineLiveConnectorProvider", () => {
  it("createConnector requires a URL and builds a live input from it", () => {
    expect(() => adapter.createConnector({ provider: "acme" })).toThrow(
      "Acme connector requires a connection URL (config.url).",
    );

    const filters = { tables: ["public.*"] };
    const result = adapter.createConnector({ provider: "acme", url: "acme://h/db", filters });
    expect(runners).toEqual(["acme://h/db"]);
    expect(result).toMatchObject({ mode: "live", connector, input: { mode: "live", filters } });
  });

  it("resolveConnection prefers --url, phrases missing config per surface, rejects --from-export, and labels the connection from the spec's connectionLabelParts", () => {
    const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("acme", request);
    expect(resolve({ runtime: runtime("acme://u:S3cret@config/db") })).toEqual({
      ok: true,
      connection: { url: "acme://u:S3cret@config/db" },
      sourceLabel: "acme://config/db",
    });
    const flag = resolve({ explicit: { url: "acme://flag/db" }, runtime: runtime("acme://config/db") });
    expect(flag.ok && flag.connection.url).toBe("acme://flag/db");
    // A stray --prisma-schema is ignored, as MySQL, SQLite and SQL Server did before the registry.
    const stray = resolve({ explicit: { url: "acme://flag/db", schemaPath: "x.prisma" }, runtime: runtime() });
    expect(stray).toEqual({ ok: true, connection: { url: "acme://flag/db" }, sourceLabel: "acme://flag/db" });

    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({ ok: false, error: "cli: pass --url" });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({ ok: false, error: "config: set acmeUrl" });

    expect(resolve({ explicit: { fromExport: "./b" }, runtime: runtime("acme://h/db") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got acme).",
    });
  });
});
