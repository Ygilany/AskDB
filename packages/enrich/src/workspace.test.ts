import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
  existsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSchema,
  loadSchemaFromJson,
  SchemaParseError,
  type TenantPolicyFrontmatter,
} from "@askdb/core";
import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
import { table, tableMd, writeSchema } from "./test-utils.js";
import { buildFrontmatter, buildTableDraft } from "./draft.js";
import {
  buildDefaultTableBody,
  bundleSchemaDirectory,
  loadWorkspace,
  replaceH2Section,
  replaceTableDescription,
  saveTable,
  saveConcepts,
  saveTenantPolicy,
  pruneOrphanedColumns,
  validateConceptLinks,
  type Workspace,
} from "./workspace.js";

const FIXTURE = new URL(
  "../../../fixtures/schemas/orders-users.schema",
  import.meta.url,
).pathname;

const MULTI_TENANT_FIXTURE = new URL(
  "../../../fixtures/schemas/agency-multi-tenant.schema",
  import.meta.url,
).pathname;

/** A tenant policy the core loader accepts for the orders-users fixture. */
const ACCOUNT_POLICY: TenantPolicyFrontmatter = {
  schemaId: "orders-users",
  enforcement: "strict",
  roots: [{ id: "table:public.users", tenantIdColumn: "table:public.users#id", label: "Account" }],
};

describe("workspace", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-enrich-ws-"));
    schemaDir = join(tmp, "orders-users.schema");
    cpSync(FIXTURE, schemaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
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

    // The workspace held in memory sees the saved state too
    expect(orders.parsed?.body).toContain("Updated order description.");

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

    const conceptsPath = join(schemaDir, "concepts.md");
    const before = readFileSync(conceptsPath, "utf8");
    expect(() =>
      saveConcepts(ws, {
        concepts: [{ id: "concept:bad", label: "Bad", links: ["table:public.missing"] }],
      }),
    ).toThrow(/Invalid concept link/);
    expect(readFileSync(conceptsPath, "utf8")).toBe(before);

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

  // A checkout can carry a symbolic link at either file (git stores them), and Studio
  // saves into the schema directory for as long as it runs.
  it.each([
    { file: "concepts.md", save: (ws: Workspace) => saveConcepts(ws, { concepts: [] }) },
    { file: "tenant-policy.md", save: (ws: Workspace) => saveTenantPolicy(ws, ACCOUNT_POLICY, "") },
  ])("refuses to write $file through a symbolic link", ({ file, save }) => {
    const ws = loadWorkspace(schemaDir);
    const outside = join(tmp, "outside.md");
    writeFileSync(outside, "untouched\n", "utf8");
    rmSync(join(schemaDir, file), { force: true });
    symlinkSync(outside, join(schemaDir, file));

    expect(() => save(ws)).toThrow(
      `Refusing to write ${file} outside the schema directory: "${file}" is a symbolic link`,
    );
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });

  it("saveTenantPolicy writes a policy the core loader then enforces", () => {
    const ws = loadWorkspace(schemaDir);
    saveTenantPolicy(ws, ACCOUNT_POLICY, "Each account sees only its own orders.\n");

    const { tenantPolicy } = loadSchema(schemaDir);
    expect(tenantPolicy).toMatchObject({
      enforcement: "strict",
      roots: [{ id: "table:public.users", tenantIdColumn: "table:public.users#id", label: "Account" }],
    });
    expect(tenantPolicy?.body).toContain("Each account sees only its own orders.");
  });

  // Any authoring surface gets the loader's rules, not only Studio: a policy that
  // `loadSchema` rejects (#375: two labels deriving one placeholder) must not reach
  // disk, or every later load of the schema directory fails until it's fixed by hand.
  it("saveTenantPolicy refuses a policy the loader would reject, and writes nothing", () => {
    const ws = loadWorkspace(schemaDir);
    const clash = { id: "table:public.orders", tenantIdColumn: "table:public.orders#id", label: "account" };

    expect(() =>
      saveTenantPolicy(ws, { ...ACCOUNT_POLICY, roots: [...ACCOUNT_POLICY.roots, clash] }, ""),
    ).toThrow(SchemaParseError);
    expect(existsSync(join(schemaDir, "tenant-policy.md"))).toBe(false);
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
    expect(bundle).not.toHaveProperty("tenantPolicy");
  });

  it("sensitivity marked in a draft round-trips through saveTable into the core loader (escalate-only)", () => {
    const ws = loadWorkspace(schemaDir);
    const orders = ws.tables.find((t) => t.physical.name === "orders")!;
    const users = ws.tables.find((t) => t.physical.name === "users")!;
    const statusId = "table:public.orders#status";
    const emailId = "table:public.users#email";

    // Studio's Sensitivity tab: mark orders.status Sensitive...
    const ordersDraft = buildTableDraft(orders.physical, orders.parsed);
    ordersDraft.columns[statusId] = { ...ordersDraft.columns[statusId], sensitive: true };
    saveTable(ws, orders.physical.id, buildFrontmatter(orders.physical, "orders-users", ordersDraft), orders.parsed!.body);
    // ...and try to mark users.email (sensitive in schema.json) Not sensitive.
    const usersDraft = buildTableDraft(users.physical, users.parsed);
    usersDraft.columns[emailId] = { ...usersDraft.columns[emailId], sensitive: false };
    saveTable(ws, users.physical.id, buildFrontmatter(users.physical, "orders-users", usersDraft), users.parsed!.body);

    const reloaded = loadWorkspace(schemaDir);
    const reloadedOrders = reloaded.tables.find((t) => t.physical.name === "orders")!;
    expect(buildTableDraft(reloadedOrders.physical, reloadedOrders.parsed).columns[statusId]?.sensitive).toBe(true);

    const schema = loadSchema(schemaDir);
    const column = (id: string) => schema.tables.flatMap((t) => t.columns).find((c) => c.id === id)!;
    expect(column(statusId).sensitive).toBe(true);
    expect(column(emailId).sensitive).toBe(true);
    expect(schema.warnings).toContainEqual({
      kind: "sensitivity_downgrade_ignored",
      tableFile: "tables/users.md",
      id: emailId,
    });
    // Studio surfaces loader warnings through the workspace.
    expect(reloaded.warnings).toContainEqual(expect.objectContaining({ kind: "sensitivity_downgrade_ignored" }));

    expect(loadSchemaFromJson(JSON.stringify(bundleSchemaDirectory(schemaDir)))).toEqual(schema);
  });

  describe("a sensitive column entry filed in another table's markdown", () => {
    const createdAtId = "table:public.users#created_at";
    beforeEach(() => {
      const ordersPath = join(schemaDir, "tables/orders.md");
      writeFileSync(
        ordersPath,
        readFileSync(ordersPath, "utf8").replace(
          "columns:\n",
          `columns:\n  - id: ${createdAtId}\n    sensitive: true\n`,
        ),
      );
    });
    const createdAtSensitive = () =>
      loadSchema(schemaDir).tables.flatMap((t) => t.columns).find((c) => c.id === createdAtId)!.sensitive;

    it("survives saving that table's draft, so the loader still escalates it", () => {
      expect(createdAtSensitive()).toBe(true);
      const ws = loadWorkspace(schemaDir);
      const orders = ws.tables.find((t) => t.physical.name === "orders")!;
      const draft = buildTableDraft(orders.physical, orders.parsed);
      draft.aliases = [...(draft.aliases ?? []), "purchase_orders"];
      saveTable(ws, orders.physical.id, buildFrontmatter(orders.physical, "orders-users", draft, orders.parsed!.frontmatter), orders.parsed!.body);
      expect(createdAtSensitive()).toBe(true);
    });

    it("is reported on the owning table, since that table's draft can't show it", () => {
      const ws = loadWorkspace(schemaDir);
      expect(ws.tables.find((t) => t.physical.name === "users")!.escalatedByOtherFiles).toEqual([createdAtId]);
      expect(ws.tables.find((t) => t.physical.name === "orders")!.escalatedByOtherFiles).toEqual([]);
    });
  });
});

describe("bundleSchemaDirectory with a tenant policy", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-enrich-bundle-"));
    schemaDir = join(tmp, "agency-multi-tenant.schema");
    cpSync(MULTI_TENANT_FIXTURE, schemaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes raw tenant-policy.md and round-trips to the same normalized schema", () => {
    const bundle = bundleSchemaDirectory(schemaDir);
    expect(bundle.tenantPolicy).toBe(readFileSync(join(schemaDir, "tenant-policy.md"), "utf8"));

    const fromDir = loadSchema(schemaDir);
    expect(fromDir.tenantPolicy).toBeDefined();

    expect(loadSchemaFromJson(JSON.stringify(bundle))).toEqual(fromDir);

    // Same path `askdb bundle` takes: write to disk, load the file.
    const bundlePath = join(tmp, "agency.schema.bundle.json");
    writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    const fromFile = loadSchema(bundlePath);
    expect(fromFile).toEqual(fromDir);
    expect(fromFile.tenantPolicy).toEqual(fromDir.tenantPolicy);
  });

  // The directory loader treats only a missing file as "no policy". A bundler that
  // skipped an unreadable one would write a bundle that loads with enforcement off.
  it("refuses to bundle when tenant-policy.md exists but can't be read, as loadSchema does", () => {
    const policyPath = join(schemaDir, "tenant-policy.md");
    rmSync(policyPath);
    symlinkSync("tenant-policy.md", policyPath); // a link to itself: ELOOP

    expect(() => loadSchema(schemaDir)).toThrow(/ELOOP/);
    expect(() => bundleSchemaDirectory(schemaDir)).toThrow(/ELOOP/);
  });

  it("refuses to bundle when tables/ exists but can't be listed, as loadSchema does", () => {
    const tablesPath = join(schemaDir, "tables");
    rmSync(tablesPath, { recursive: true, force: true });
    symlinkSync("tables", tablesPath);

    expect(() => loadSchema(schemaDir)).toThrow(/ELOOP/);
    expect(() => bundleSchemaDirectory(schemaDir)).toThrow(/ELOOP/);
  });
});

describe("workspace table filenames", () => {
  let tmp: string;
  let schemaDir: string;

  const filenameOf = (ws: ReturnType<typeof loadWorkspace>, id: string) =>
    ws.tables.find((t) => t.physical.id === id)?.filename;

  const saveDescribed = (ws: ReturnType<typeof loadWorkspace>, id: string) => {
    const name = ws.tables.find((t) => t.physical.id === id)!.physical.name;
    saveTable(ws, id, { id, name, schemaId: "fname" }, buildDefaultTableBody(name, `About ${id}.`));
  };

  /** Save every table, then check each one reads back from disk with its own description. */
  const saveAllAndReload = (ws: ReturnType<typeof loadWorkspace>) => {
    for (const t of ws.tables) saveDescribed(ws, t.physical.id);
    expect(readdirSync(join(schemaDir, "tables"))).toHaveLength(ws.tables.length);
    for (const t of loadSchema(schemaDir).tables) expect(t.description).toBe(`About ${t.id}.`);
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-enrich-fname-"));
    schemaDir = join(tmp, "fname.schema");
    mkdirSync(schemaDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses schema-qualified filenames when bare table names collide", () => {
    writeSchema(schemaDir, [table("public", "orders"), table("archive", "orders"), table("public", "users")]);
    const ws = loadWorkspace(schemaDir);
    expect(filenameOf(ws, "table:public.orders")).toBe("public.orders.md");
    expect(filenameOf(ws, "table:archive.orders")).toBe("archive.orders.md");
    expect(filenameOf(ws, "table:public.users")).toBe("users.md");

    saveAllAndReload(ws);
  });

  // APFS and NTFS compare names case-insensitively, and APFS also ignores Unicode
  // normalization, so each pair below names one file there. Postgres and SQL Server
  // treat each pair as two distinct quoted identifiers.
  it.each([
    ["case", "Orders", "orders"],
    ["Unicode normalization (NFC vs NFD)", "caf\u00e9", "cafe\u0301"],
    ["full case folding (ß vs SS)", "straße", "STRASSE"],
    ["full case folding (ß vs capital sharp s ẞ)", "straße", "STRA\u1e9eE"],
  ])("gives names that differ only by %s distinct default files", (_, first, second) => {
    writeSchema(schemaDir, [table("public", first), table("public", second)]);
    const ws = loadWorkspace(schemaDir);
    expect(ws.tables.map((t) => t.filename)).toEqual([
      `public.${first}.md`,
      `public.${second}-2.md`,
    ]);
    saveAllAndReload(ws);
  });

  it("keeps existing filenames stable and does not overwrite them", () => {
    writeSchema(schemaDir, [table("public", "orders"), table("archive", "orders")]);
    const existing = tableMd("public", "orders", "Live orders.");
    writeFileSync(join(schemaDir, "tables/orders.md"), existing, "utf8");
    writeFileSync(
      join(schemaDir, "tables/Custom Name.md"),
      tableMd("archive", "orders", "Archived orders."),
      "utf8",
    );

    const ws = loadWorkspace(schemaDir);
    expect(filenameOf(ws, "table:public.orders")).toBe("orders.md");
    expect(filenameOf(ws, "table:archive.orders")).toBe("Custom Name.md");

    saveDescribed(ws, "table:archive.orders");
    expect(readFileSync(join(schemaDir, "tables/orders.md"), "utf8")).toBe(existing);
    expect(readFileSync(join(schemaDir, "tables/Custom Name.md"), "utf8")).toContain(
      "About table:archive.orders.",
    );
    expect(readdirSync(join(schemaDir, "tables")).sort()).toEqual(["Custom Name.md", "orders.md"]);
  });

  it("does not reuse a filename already on disk for a new table", () => {
    writeSchema(schemaDir, [table("public", "orders"), table("archive", "orders")]);
    const existing = tableMd("public", "orders", "Live orders.");
    writeFileSync(join(schemaDir, "tables/orders.md"), existing, "utf8");

    const ws = loadWorkspace(schemaDir);
    expect(filenameOf(ws, "table:public.orders")).toBe("orders.md");
    expect(filenameOf(ws, "table:archive.orders")).toBe("archive.orders.md");

    saveTable(
      ws,
      "table:archive.orders",
      { id: "table:archive.orders", name: "orders", schemaId: "fname" },
      buildDefaultTableBody("orders", "Archived orders."),
    );
    expect(readFileSync(join(schemaDir, "tables/orders.md"), "utf8")).toBe(existing);
    expect(readFileSync(join(schemaDir, "tables/archive.orders.md"), "utf8")).toContain(
      "Archived orders.",
    );

    // An orphaned file (id not in schema.json) also blocks its name.
    writeSchema(schemaDir, [table("public", "orders"), table("public", "legacy")]);
    const orphan = tableMd("public", "gone", "Orphan.");
    writeFileSync(join(schemaDir, "tables/legacy.md"), orphan, "utf8");
    const ws2 = loadWorkspace(schemaDir);
    expect(filenameOf(ws2, "table:public.legacy")).toBe("public.legacy.md");

    // So does one whose name is the same file on a case-insensitive filesystem.
    rmSync(join(schemaDir, "tables"), { recursive: true });
    writeSchema(schemaDir, [table("public", "straße")]);
    writeFileSync(join(schemaDir, "tables/STRASSE.md"), tableMd("public", "gone", "Orphan."), "utf8");
    expect(filenameOf(loadWorkspace(schemaDir), "table:public.straße")).toBe("public.straße.md");

    // And so does a file AskDB itself ignores, such as one with an upper-case extension.
    rmSync(join(schemaDir, "tables"), { recursive: true });
    writeSchema(schemaDir, [table("public", "orders")]);
    writeFileSync(join(schemaDir, "tables/Orders.MD"), "precious notes\n", "utf8");
    const ws3 = loadWorkspace(schemaDir);
    expect(filenameOf(ws3, "table:public.orders")).toBe("public.orders.md");
    saveDescribed(ws3, "table:public.orders");
    expect(readFileSync(join(schemaDir, "tables/Orders.MD"), "utf8")).toBe("precious notes\n");

    // A file with another name, such as a different extension, doesn't.
    rmSync(join(schemaDir, "tables"), { recursive: true });
    writeSchema(schemaDir, [table("public", "orders")]);
    writeFileSync(join(schemaDir, "tables/orders.txt"), "scratch\n", "utf8");
    const ws4 = loadWorkspace(schemaDir);
    expect(filenameOf(ws4, "table:public.orders")).toBe("orders.md");
  });

  it("sanitizes identifiers so default filenames stay inside tables/", () => {
    writeSchema(schemaDir, [
      table("public", "../../escape"),
      table("public", ".."),
      table("public", "a\\b\u0000c"),
      table("public", ".hidden"),
    ]);
    const ws = loadWorkspace(schemaDir);
    for (const t of ws.tables) {
      expect(t.filename).not.toMatch(/[/\\\u0000]/);
      expect(t.filename.startsWith(".")).toBe(false);
    }
    saveAllAndReload(ws);
    expect(readdirSync(tmp)).toEqual(["fname.schema"]);
    expect(readdirSync(schemaDir).sort()).toEqual(["schema.json", "tables"]);
  });

  it("gives names that differ only by a lone UTF-16 surrogate distinct files", () => {
    // Node writes a lone surrogate in a path as U+FFFD, so left alone these two
    // would both be `a\ufffd.md` on disk.
    writeSchema(schemaDir, [table("public", "a\ud800"), table("public", "a\ud801")]);
    const ws = loadWorkspace(schemaDir);
    expect(ws.tables.map((t) => t.filename)).toEqual(["public.a_.md", "public.a_-2.md"]);
    // The frontmatter escapes each id, so both read back; the descriptions avoid
    // surrogates, which UTF-8 markdown text can't hold.
    for (const [i, t] of ws.tables.entries()) {
      const { id, name } = t.physical;
      saveTable(ws, id, { id, name, schemaId: "fname" }, buildDefaultTableBody(name, `Table ${i}.`));
    }
    expect(loadSchema(schemaDir).tables.map((t) => [t.id, t.description])).toEqual([
      ["table:public.a\ud800", "Table 0."],
      ["table:public.a\ud801", "Table 1."],
    ]);
  });

  it("keeps a character outside the BMP, which is a surrogate pair, in the filename", () => {
    writeSchema(schemaDir, [table("public", "a😀")]);
    const ws = loadWorkspace(schemaDir);
    expect(filenameOf(ws, "table:public.a😀")).toBe("a😀.md");
    saveAllAndReload(ws);
  });

  it("saveTable refuses a filename that resolves outside tables/", () => {
    writeSchema(schemaDir, [table("public", "orders")]);
    const ws = loadWorkspace(schemaDir);
    const fm = { id: "table:public.orders", name: "orders", schemaId: "fname" };
    for (const bad of ["../escape.md", "sub/orders.md", "..", "/tmp/abs.md", "orders.txt"]) {
      ws.tables[0]!.filename = bad;
      expect(() => saveTable(ws, "table:public.orders", fm, "# Table: orders\n")).toThrow(
        /outside tables\//,
      );
    }
    expect(readdirSync(tmp)).toEqual(["fname.schema"]);
  });

  it("saveTable refuses to write through a symbolic link in tables/", () => {
    writeSchema(schemaDir, [table("public", "orders")]);
    const ws = loadWorkspace(schemaDir);
    const outside = join(tmp, "outside.md");
    writeFileSync(outside, "untouched\n", "utf8");
    // Planted after load, as a long-running Studio session would meet it.
    symlinkSync(outside, join(schemaDir, "tables", "orders.md"));

    expect(() => saveDescribed(ws, "table:public.orders")).toThrow(
      'Refusing to write tables/orders.md outside the schema directory: "orders.md" is a symbolic link',
    );
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });

  integrationSuite({
    unavailable: process.platform === "win32" ? "`\\` separates paths on Windows" : false,
  })("saveTable and a backslash in a filename", () => {
    it("saves a table whose existing file has a backslash in its name", () => {
      writeSchema(schemaDir, [table("public", "ord\\ers")]);
      const target = join(schemaDir, "tables", "ord\\ers.md");
      writeFileSync(target, tableMd("public", "ord\\ers", "Written before."), "utf8");
      const ws = loadWorkspace(schemaDir);
      expect(filenameOf(ws, "table:public.ord\\ers")).toBe("ord\\ers.md");

      saveDescribed(ws, "table:public.ord\\ers");
      expect(readFileSync(target, "utf8")).toContain("About table:public.ord\\ers.");
      expect(readdirSync(join(schemaDir, "tables"))).toEqual(["ord\\ers.md"]);
    });
  });

  it("saveTable refuses to write when tables/ is a symbolic link", () => {
    writeSchema(schemaDir, [table("public", "orders")]);
    rmSync(join(schemaDir, "tables"), { recursive: true });
    const elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(schemaDir, "tables"));
    const ws = loadWorkspace(schemaDir);

    expect(() => saveDescribed(ws, "table:public.orders")).toThrow(
      "Refusing to write tables/orders.md outside the schema directory: tables/ is a symbolic link",
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("shortens default filenames that would exceed file system name limits", () => {
    // SQL Server allows 128-character identifiers, so a schema-qualified name can be
    // 260 bytes, and 128 CJK characters are 384 bytes even unqualified. Most file
    // systems cap one name at 255 bytes.
    const long = "n".repeat(128);
    writeSchema(schemaDir, [
      table("s".repeat(128), long),
      table("x".repeat(128), long),
      table("public", "表".repeat(128)),
    ]);
    const ws = loadWorkspace(schemaDir);
    for (const t of ws.tables) {
      expect(Buffer.byteLength(t.filename.normalize("NFD"))).toBeLessThanOrEqual(200);
      expect(t.filename).toMatch(/~[0-9a-f]{8}\.md$/);
    }
    expect(filenameOf(ws, `table:${"s".repeat(128)}.${long}`)).toMatch(/^s{128}\.n+~/);
    saveAllAndReload(ws);
  });

  it("keeps long names that share a truncated prefix apart by their hash", () => {
    const shared = "n".repeat(250);
    writeSchema(schemaDir, [table("public", `${shared}a`), table("public", `${shared}b`)]);
    const ws = loadWorkspace(schemaDir);
    const [first, second] = ws.tables.map((t) => t.filename);
    // Both keep the bare-name form: the hash, not the schema-qualified fallback or a
    // counter, is what tells them apart.
    expect(first).toMatch(/^n+~[0-9a-f]{8}\.md$/);
    expect(second).toMatch(/^n+~[0-9a-f]{8}\.md$/);
    expect(first!.replace(/~.*$/, "")).toBe(second!.replace(/~.*$/, ""));
    expect(first).not.toBe(second);
    saveAllAndReload(ws);
  });
});
