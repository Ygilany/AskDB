import { describe, expect, it } from "vitest";
import { sqliteConnectorProvider } from "./provider.js";

const resolve = sqliteConnectorProvider.resolveConnection!;
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
        "Provide --url <path-to-sqlite-file> (or set introspection.providerConfig.sqlite.file / ASKDB_INTROSPECT_SQLITE_FILE).",
    });
    expect(resolve({ runtime: runtime() })).toEqual({
      ok: false,
      error: "No SQLite file configured. Set introspection.providerConfig.sqlite.file in askdb.config.ts.",
    });
  });

  it("createConnector requires a file path", () => {
    expect(() => sqliteConnectorProvider.createConnector({ provider: "sqlite" })).toThrow(
      "SQLite connector requires a file path (config.url).",
    );
  });
});
