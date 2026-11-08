import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import type { NormalizedV2Column, NormalizedV2Table } from "./index.js";

// Unused outside @askdb/core and removed from its public API before 1.0 (#654).
describe("@askdb/core public API", () => {
  it.each([
    "placeholderForRoot",
    "ENRICHMENT_SYSTEM_PROMPT",
    "buildEnrichmentUserPrompt",
    "parseCandidates",
  ])("@askdb/core doesn't export %s", (name) => {
    expect(api).not.toHaveProperty(name);
  });
});

describe("@askdb/core public API — table and column fields (#898)", () => {
  it("loadSchema() fills NormalizedV2Table.businessContext and NormalizedV2Column.note", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-public-api-"));
    try {
      const dir = join(root, "orders-users.schema");
      cpSync(join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/schemas/orders-users.schema"), dir, { recursive: true });
      const file = join(dir, "tables/orders.md");
      writeFileSync(file, `${readFileSync(file, "utf8")}\n## Column notes\n\n- \`status\`: refunds flip a paid order back to pending\n`);
      const orders: NormalizedV2Table = api.loadSchema(dir).tables.find((t) => t.name === "orders")!;
      const status: NormalizedV2Column = orders.columns.find((c) => c.name === "status")!;
      expect(orders.businessContext).toMatch(/^Orders move through/);
      expect(status.note).toBe("refunds flip a paid order back to pending");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
