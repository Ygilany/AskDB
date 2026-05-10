import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSchema, loadSchemaFromJson } from "@askdb/core";
import {
  bundleSchemaDirectory,
  loadWorkspace,
  replaceH2Section,
  replaceTableDescription,
  saveTable,
  saveConcepts,
  pruneOrphanedColumns,
  validateConceptLinks,
} from "./workspace.js";

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

  it("replaceH2Section updates one section without touching following sections", () => {
    const original = [
      "# Table: orders",
      "",
      "Description.",
      "",
      "## Common query language",
      "",
      "- old",
      "",
      "## Example questions",
      "",
      "- keep me",
      "",
    ].join("\n");

    const next = replaceH2Section(
      original,
      "Common query language",
      "- sales = paid orders",
    );

    expect(next).toContain("## Common query language\n\n- sales = paid orders\n");
    expect(next).not.toContain("- old");
    expect(next).toContain("## Example questions");
    expect(next).toContain("- keep me");
  });

  it("replaceH2Section appends a missing section", () => {
    const next = replaceH2Section("# Table: users\n\nDescription.\n", "Example questions", "- Who signed up?");

    expect(next).toContain("## Example questions\n\n- Who signed up?\n");
  });

  it("validates and saves concept links against table and column ids", () => {
    const ws = loadWorkspace(schemaDir);
    expect(
      validateConceptLinks(ws, [
        {
          id: "concept:customer",
          label: "Customer",
          links: ["table:public.users", "table:public.orders#total_amount"],
        },
      ]),
    ).toEqual([]);

    expect(
      validateConceptLinks(ws, [
        { id: "concept:bad", label: "Bad", links: ["table:public.missing"] },
      ]),
    ).toEqual(["table:public.missing"]);

    saveConcepts(ws, {
      concepts: [
        {
          id: "concept:vip_customer",
          label: "VIP Customer",
          links: ["table:public.users"],
        },
      ],
    });

    const saved = readFileSync(join(schemaDir, "concepts.md"), "utf8");
    expect(saved).toContain("concept:vip_customer");
    expect(saved).toContain("table:public.users");
  });

  it("surfaces new column ids and prunes orphaned column frontmatter", () => {
    const schemaPath = join(schemaDir, "schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      tables: Array<{ name: string; columns: Array<Record<string, unknown>> }>;
    };
    schema.tables
      .find((table) => table.name === "orders")!
      .columns.push({
        id: "table:public.orders#coupon_code",
        name: "coupon_code",
        type: "text",
        nullable: true,
        sensitive: false,
      });
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

    const ordersPath = join(schemaDir, "tables/orders.md");
    const ordersMd = readFileSync(ordersPath, "utf8").replace(
      "columns:\n",
      "columns:\n  - id: table:public.orders#old_column\n    description: Removed column.\n",
    );
    writeFileSync(ordersPath, ordersMd, "utf8");

    const ws = loadWorkspace(schemaDir);
    expect(ws.warnings).toContainEqual({
      kind: "missing_column_md",
      tableId: "table:public.orders",
      columnId: "table:public.orders#coupon_code",
    });
    expect(ws.warnings).toContainEqual({
      kind: "orphaned_column_id",
      tableFile: "tables/orders.md",
      id: "table:public.orders#old_column",
    });

    expect(pruneOrphanedColumns(ws)).toBe(1);
    const saved = readFileSync(ordersPath, "utf8");
    expect(saved).not.toContain("old_column");
  });

  it("bundles a schema directory into a loader-compatible single JSON object", () => {
    const bundle = bundleSchemaDirectory(schemaDir);
    expect(bundle.bundled).toBe(true);
    expect(Object.keys(bundle.tables)).toContain("orders.md");
    expect(bundle.concepts).toContain("concept:customer");

    const fromDir = loadSchema(schemaDir);
    const fromBundle = loadSchemaFromJson(JSON.stringify(bundle));
    expect(fromBundle).toEqual(fromDir);
  });
});
