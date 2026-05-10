import { mkdtempSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkspace, replaceTableDescription, saveTable } from "./workspace.js";

const FIXTURE = new URL(
  "../../../fixtures/schemas/orders-users.schema",
  import.meta.url,
).pathname;

describe("workspace", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-tui-ws-"));
    schemaDir = join(tmp, "orders-users.schema");
    cpSync(FIXTURE, schemaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loadWorkspace pairs physical tables with markdown by id", () => {
    const ws = loadWorkspace(schemaDir);
    expect(ws.physical.schemaId).toBe("orders-users");
    expect(ws.tables).toHaveLength(2);
    const orders = ws.tables.find((t) => t.physical.name === "orders");
    expect(orders).toBeDefined();
    expect(orders?.filename).toBe("orders.md");
    expect(orders?.parsed?.frontmatter.id).toBe("table:public.orders");
  });

  it("saveTable updates description and re-parses to the saved state", () => {
    const ws = loadWorkspace(schemaDir);
    const orders = ws.tables.find((t) => t.physical.name === "orders")!;
    const newBody = replaceTableDescription(
      orders.parsed!.body,
      "Updated order description.",
    );
    saveTable(ws, orders.physical.id, orders.parsed!.frontmatter, newBody);

    const onDisk = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(onDisk).toContain("Updated order description.");
    // H2 sections preserved
    expect(onDisk).toContain("## Common query language");
    expect(onDisk).toContain("## Example questions");
    expect(onDisk).toContain("## Business context");
    // Original frontmatter aliases preserved
    expect(onDisk).toContain("primaryEntity: order");

    // Re-load to confirm round-trip
    const ws2 = loadWorkspace(schemaDir);
    const orders2 = ws2.tables.find((t) => t.physical.name === "orders")!;
    expect(orders2.parsed?.body).toContain("Updated order description.");
    expect(orders2.parsed?.sections["Common query language"]).toBeDefined();
  });

  it("replaceTableDescription preserves H1, H2 sections, and ordering", () => {
    const original = [
      "",
      "# Table: orders",
      "",
      "Old description here.",
      "",
      "## Common query language",
      "",
      "- foo",
      "",
      "## Example questions",
      "",
      "- bar",
    ].join("\n");
    const next = replaceTableDescription(original, "New description.");
    expect(next).toContain("# Table: orders");
    expect(next).toContain("New description.");
    expect(next).not.toContain("Old description here.");
    expect(next).toContain("## Common query language");
    expect(next).toContain("- foo");
    expect(next).toContain("## Example questions");
    expect(next).toContain("- bar");
    // The Common query language section appears AFTER the new description.
    const descIdx = next.indexOf("New description.");
    const cqlIdx = next.indexOf("## Common query language");
    expect(descIdx).toBeLessThan(cqlIdx);
  });
});
