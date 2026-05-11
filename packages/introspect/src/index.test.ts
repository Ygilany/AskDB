import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToSchemaV2 } from "./index.js";

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
});
