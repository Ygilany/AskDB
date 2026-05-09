import type { AskDbExecutor } from "@askdb/core";
import { describe, expect, it } from "vitest";
import { renderToSchemaV2 } from "./index.js";
import { createPostgresConnector } from "./postgres/index.js";

const noopExecutor: AskDbExecutor = async () => ({ columns: [], rows: [] });

describe("@askdb/introspect public surface", () => {
  it("exports renderToSchemaV2() that throws until milestone 3 wires it in", () => {
    expect(() =>
      renderToSchemaV2(
        { schemaId: "x", schemas: [] },
        { outDir: "/tmp/x.schema", schemaId: "x" },
      ),
    ).toThrow(/not implemented yet/);
  });

  it("exposes a postgres connector with engine='postgres'", () => {
    const connector = createPostgresConnector();
    expect(connector.engine).toBe("postgres");
  });

  it("postgres connector accepts a live IntrospectionInput shape", async () => {
    // We do not assert on the result here; M2 wires describe() and adds richer tests.
    const connector = createPostgresConnector();
    await expect(
      connector.describe({ mode: "live", executor: noopExecutor }),
    ).resolves.toBeDefined();
  });
});
