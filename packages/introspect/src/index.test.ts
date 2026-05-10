import type { AskDbExecutor } from "@askdb/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToSchemaV2 } from "./index.js";
import { createPostgresConnector } from "./postgres/index.js";

const noopExecutor: AskDbExecutor = async () => ({ columns: [], rows: [] });

describe("@askdb/introspect public surface", () => {
  it("exports renderToSchemaV2()", () => {
    const outDir = mkdtempSync(join(tmpdir(), "askdb-introspect-surface-"));
    try {
      const render = renderToSchemaV2(
        { schemaId: "x", schemas: [] },
        { outDir, schemaId: "x" },
      );
      expect(render.schemaJsonPath).toBe(join(outDir, "schema.json"));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
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
