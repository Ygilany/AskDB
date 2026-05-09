import { describe, expect, it } from "vitest";
import { introspect, renderToSchemaV2 } from "./index.js";
import { createPostgresConnector } from "./postgres/index.js";

describe("@askdb/introspect public surface (milestone 1 skeleton)", () => {
  it("exports introspect() that throws until milestone 2+ wires it in", async () => {
    await expect(
      introspect({
        mode: "live",
        executor: { run: async () => ({ columns: [], rows: [] }) },
      }),
    ).rejects.toThrow(/not implemented yet/);
  });

  it("exports renderToSchemaV2() that throws until milestone 3 wires it in", () => {
    expect(() =>
      renderToSchemaV2(
        { schemaId: "x", schemas: [] },
        { outDir: "/tmp/x.schema", schemaId: "x" },
      ),
    ).toThrow(/not implemented yet/);
  });

  it("exposes a postgres connector with engine='postgres' and stubbed members", async () => {
    const connector = createPostgresConnector();
    expect(connector.engine).toBe("postgres");
    expect(() => connector.templates()).toThrow(/not implemented yet/);
    await expect(
      connector.describe({
        mode: "live",
        executor: { run: async () => ({ columns: [], rows: [] }) },
      }),
    ).rejects.toThrow(/not implemented yet/);
  });
});
