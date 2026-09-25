import { describe, expect, it } from "vitest";
import type { CatalogQueryRunner, Connector } from "../types.js";
import { defineLiveConnectorProvider, type LiveCatalogInput } from "./index.js";

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
  redactConnectionString: (input) => input.replace("S3cret", "****"),
});
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

  it("resolveConnection prefers --url, phrases missing config per surface, rejects --from-export, and redacts the label", () => {
    const resolve = adapter.resolveConnection!;
    expect(resolve({ runtime: runtime("acme://u:S3cret@config/db") })).toEqual({
      ok: true,
      connection: { url: "acme://u:S3cret@config/db" },
      sourceLabel: "acme://u:****@config/db",
    });
    const flag = resolve({ explicit: { url: "acme://flag/db" }, runtime: runtime("acme://config/db") });
    expect(flag.ok && flag.connection.url).toBe("acme://flag/db");

    expect(resolve({ runtime: runtime(), surface: "cli" })).toEqual({ ok: false, error: "cli: pass --url" });
    expect(resolve({ runtime: runtime(), surface: "studio" })).toEqual({ ok: false, error: "config: set acmeUrl" });

    expect(resolve({ explicit: { fromExport: "./b" }, runtime: runtime("acme://h/db") })).toEqual({
      ok: false,
      error: "--from-export is currently supported only for --engine postgres (got acme).",
    });
  });
});
