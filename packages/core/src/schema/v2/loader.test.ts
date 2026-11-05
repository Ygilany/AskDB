import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { loadSchema, loadSchemaFromJson } from "./loader.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../../fixtures/schemas");
const v2Dir = join(fixturesDir, "orders-users.schema");
const v2SchemaJson = join(v2Dir, "schema.json");
const v1FixtureJson = join(fixturesDir, "orders-users.schema.json");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "askdb-loader-"));
  tempDirs.push(dir);
  return dir;
}
/** Copy a fixture schema directory into a temp dir so tests can corrupt files safely. */
function copyFixture(src: string): string {
  const dir = join(makeTempDir(), "copy.schema");
  cpSync(src, dir, { recursive: true });
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** The value `fn` throws, or `undefined` when it returns. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

const MALFORMED_TENANT_POLICY = [
  "---",
  "schemaId: agency-multi-tenant",
  "enforcement: strict",
  "roots:",
  "  - id: table:public.agencies",
  "    tenantIdColumn: [unclosed",
  "---",
  "# Tenant Policy",
  "",
].join("\n");

describe("loadSchema — v2 directory", () => {
  it("loads a v2 directory with full describable layer", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.schemaId).toBe("orders-users");
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "orders"]);

    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.schema).toBe("public");
    expect(users.id).toBe("table:public.users");
    expect(users.aliases).toEqual(["accounts", "members"]);
    expect(users.primaryEntity).toBe("user");
    expect(users.description).toContain("Registered user account");
    expect(users.commonQueryLanguage).toContain("new users");

    const orders = schema.tables.find((t) => t.name === "orders")!;
    expect(orders.schema).toBe("public");
    expect(orders.id).toBe("table:public.orders");
    expect(orders.aliases).toEqual(["purchases", "sales", "transactions"]);
    expect(orders.commonQueryLanguage).toContain("revenue");
  });

  it("loads concepts from concepts.md", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.concepts).toBeDefined();
    expect(schema.concepts!.map((c) => c.id)).toContain("concept:customer");
  });

  it("loads v2 directory with only schema.json (no tables/*.md) — empty describable layer", () => {
    // A directory containing nothing but schema.json: every optional file is absent.
    const dir = makeTempDir();
    copyFileSync(v2SchemaJson, join(dir, "schema.json"));
    const schema = loadSchema(dir);
    expect(schema.tables).toHaveLength(2);
    const users = schema.tables.find((t) => t.name === "users")!;
    expect(users.aliases).toBeUndefined();
    expect(users.description).toBeUndefined();
    expect(users.commonQueryLanguage).toBeUndefined();
  });

  describe("sensitiveFromTable", () => {
    /** The fixture with `users` marked sensitive in schema.json, plus an optional front-matter edit. */
    function usersSensitive(edit?: { file: string; after: string; insert: string }): string {
      const dir = copyFixture(v2Dir);
      const jsonPath = join(dir, "schema.json");
      const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { tables: { id: string; sensitive?: boolean }[] };
      json.tables.find((t) => t.id === "table:public.users")!.sensitive = true;
      writeFileSync(jsonPath, JSON.stringify(json));
      if (edit) {
        const mdPath = join(dir, "tables", edit.file);
        const md = readFileSync(mdPath, "utf8");
        expect(md).toContain(edit.after);
        writeFileSync(mdPath, md.replace(edit.after, edit.after + edit.insert));
      }
      return dir;
    }
    const usersColumns = (schema: ReturnType<typeof loadSchema>) =>
      Object.fromEntries(
        schema.tables.find((t) => t.id === "table:public.users")!.columns.map((c) => [c.name, c.sensitiveFromTable]),
      );

    it("is set only on a column sensitive solely through its table", () => {
      // `email` is marked in schema.json itself.
      expect(usersColumns(loadSchema(usersSensitive()))).toEqual({ id: true, email: undefined, created_at: true });
    });

    it.each([
      ["in its own table's front-matter", "users.md", "  - id: table:public.users#created_at\n", "    sensitive: true\n"],
      [
        "by an entry misplaced in another table's file",
        "orders.md",
        "columns:\n",
        "  - id: table:public.users#created_at\n    sensitive: true\n",
      ],
    ])("is not set on a column escalated %s", (_case, file, after, insert) => {
      const columns = usersColumns(loadSchema(usersSensitive({ file, after, insert })));
      expect(columns.created_at).toBeUndefined();
      expect(columns.id).toBe(true);
    });

    it("is set the same way for a bundle, front-matter escalation included", () => {
      const dir = usersSensitive({
        file: "users.md",
        after: "  - id: table:public.users#created_at\n",
        insert: "    sensitive: true\n",
      });
      const bundle = JSON.stringify({
        bundled: true,
        physical: JSON.parse(readFileSync(join(dir, "schema.json"), "utf8")),
        tables: { "users.md": readFileSync(join(dir, "tables", "users.md"), "utf8") },
      });
      expect(usersColumns(loadSchemaFromJson(bundle))).toEqual({ id: true, email: undefined, created_at: undefined });
    });
  });

  it("provides non-sensitive column describable fields", () => {
    const schema = loadSchema(v2Dir);
    const orders = schema.tables.find((t) => t.name === "orders")!;
    const statusCol = orders.columns.find((c) => c.name === "status")!;
    expect(statusCol.sensitive).toBe(false);
    expect(statusCol.aliases).toEqual(["order_status"]);
    expect(statusCol.enum).toEqual(["pending", "paid", "shipped", "cancelled"]);
    expect(statusCol.description).toContain("lifecycle state");
  });

  it("produces no warnings for the well-formed fixture", () => {
    const schema = loadSchema(v2Dir);
    expect(schema.warnings).toHaveLength(0);
  });
});

describe("loadSchema — v1 rejection", () => {
  it("rejects a v1 format file with a clear error message", () => {
    expect(() => loadSchema(v1FixtureJson)).toThrow(SchemaParseError);
    expect(() => loadSchema(v1FixtureJson)).toThrow(/version: 1/);
    expect(() => loadSchema(v1FixtureJson)).toThrow(/schema-v2\.md/);
  });
});

describe("loadSchema — direct schema.json path", () => {
  it("loads sibling tables/*.md and concepts.md like the directory path", () => {
    expect(loadSchema(v2SchemaJson)).toEqual(loadSchema(v2Dir));
  });

  it("loads the sibling tenant-policy.md", () => {
    const viaFile = loadSchema(join(multiTenantDir, "schema.json"));
    expect(viaFile.tenantPolicy).toBeDefined();
    expect(viaFile.tenantPolicy!.enforcement).toBe("strict");
    expect(viaFile).toEqual(loadSchema(multiTenantDir));
  });

  it("matches the schema.json name in any case, so Schema.json keeps its tenant policy", () => {
    // Physically renamed, so the case-insensitive match is exercised on every
    // filesystem, not only where Schema.json opens schema.json (macOS, Windows).
    const dir = copyFixture(multiTenantDir);
    renameSync(join(dir, "schema.json"), join(dir, "Schema.json"));
    const viaFile = loadSchema(join(dir, "Schema.json"));
    expect(viaFile.tenantPolicy?.enforcement).toBe("strict");
    expect(viaFile).toEqual(loadSchema(multiTenantDir));
  });

  it("loads a JSON file not named schema.json as a standalone physical layer when no schema files sit beside it", () => {
    const dir = makeTempDir();
    copyFileSync(join(multiTenantDir, "schema.json"), join(dir, "physical.json"));
    const schema = loadSchema(join(dir, "physical.json"));
    expect(schema.tenantPolicy).toBeUndefined();
    expect(schema.tables.length).toBeGreaterThan(0);
  });
});

describe("loadSchema — a JSON file inside a schema directory must be schema.json", () => {
  // Loading the copy standalone would drop the sibling: the tenant policy, the
  // tables/*.md `sensitive: true` escalations, or the concepts.
  const siblings: Record<string, (dir: string) => void> = {
    "tenant-policy.md": (dir) =>
      copyFileSync(join(multiTenantDir, "tenant-policy.md"), join(dir, "tenant-policy.md")),
    tables: (dir) => mkdirSync(join(dir, "tables")),
    "concepts.md": (dir) => writeFileSync(join(dir, "concepts.md"), "---\nconcepts: []\n---\n"),
  };

  it.each(Object.keys(siblings))(
    "a copy of schema.json beside %s throws SchemaParseError naming both",
    (sibling) => {
      const dir = makeTempDir();
      const copyPath = join(dir, "prod-schema.json");
      copyFileSync(join(multiTenantDir, "schema.json"), copyPath);
      siblings[sibling]!(dir);

      const caught = thrownBy(() => loadSchema(copyPath));
      expect(caught).toBeInstanceOf(SchemaParseError);
      expect((caught as SchemaParseError).message).toContain(copyPath);
      expect((caught as SchemaParseError).message).toContain(sibling);
    },
  );
});

describe("loadSchema — optional files fail closed when present but broken", () => {
  it("missing tenant-policy.md loads with no tenant policy", () => {
    const dir = copyFixture(multiTenantDir);
    rmSync(join(dir, "tenant-policy.md"));
    expect(loadSchema(dir).tenantPolicy).toBeUndefined();
  });

  it("malformed tenant-policy.md YAML throws SchemaParseError naming the file (directory path)", () => {
    const dir = copyFixture(multiTenantDir);
    const policyPath = join(dir, "tenant-policy.md");
    writeFileSync(policyPath, MALFORMED_TENANT_POLICY);
    let caught: unknown;
    try {
      loadSchema(dir);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SchemaParseError);
    expect((caught as SchemaParseError).message).toMatch(/Malformed tenant-policy front-matter YAML/);
    expect((caught as SchemaParseError).message).toContain(policyPath);
    expect((caught as SchemaParseError).cause).toBeDefined();
  });

  it("invalid tenant-policy.md front-matter values still throw SchemaParseError", () => {
    const dir = copyFixture(multiTenantDir);
    const policyPath = join(dir, "tenant-policy.md");
    writeFileSync(
      policyPath,
      readFileSync(policyPath, "utf8").replace("enforcement: strict", "enforcement: strictt"),
    );
    expect(() => loadSchema(dir)).toThrow(SchemaParseError);
  });

  it("unreadable tenant-policy.md (a directory, not a file) throws SchemaParseError", () => {
    const dir = copyFixture(multiTenantDir);
    rmSync(join(dir, "tenant-policy.md"));
    mkdirSync(join(dir, "tenant-policy.md"));
    expect(() => loadSchema(dir)).toThrow(SchemaParseError);
  });

  it("malformed concepts.md YAML throws SchemaParseError", () => {
    const dir = copyFixture(v2Dir);
    writeFileSync(join(dir, "concepts.md"), "---\nconcepts: [unclosed\n---\n");
    expect(() => loadSchema(dir)).toThrow(SchemaParseError);
  });

  it("malformed tables/*.md YAML throws SchemaParseError", () => {
    const dir = copyFixture(v2Dir);
    writeFileSync(join(dir, "tables", "broken.md"), "---\nid: [unclosed\n---\n");
    expect(() => loadSchema(dir)).toThrow(SchemaParseError);
  });

  it("empty tenant-policy.md throws SchemaParseError instead of disabling tenancy", () => {
    const dir = copyFixture(multiTenantDir);
    writeFileSync(join(dir, "tenant-policy.md"), "");
    expect(() => loadSchema(dir)).toThrow(SchemaParseError);
  });
});

// A policy that no longer matches schema.json (a renamed column, a cycle) is a
// validation error under `enforcement: strict`: the load fails closed instead of
// returning a policy whose problems only Studio shows (#332, ADR 0023).
describe("loadSchema — a tenant policy that doesn't match schema.json", () => {
  /** Copy the multi-tenant fixture, edit its tenant-policy.md, and return the directory. */
  function editedPolicy(edit: (policy: string) => string): { dir: string; policyPath: string } {
    const dir = copyFixture(multiTenantDir);
    const policyPath = join(dir, "tenant-policy.md");
    const before = readFileSync(policyPath, "utf8");
    const after = edit(before);
    expect(after).not.toBe(before);
    writeFileSync(policyPath, after);
    return { dir, policyPath };
  }
  const addCycle = (policy: string) =>
    policy.replace(
      "hierarchy:\n",
      "hierarchy:\n  - parent: table:public.clients\n    child: table:public.agencies\n    foreignKey: table:public.agencies#id\n",
    );
  const renameScopeColumn = (policy: string) =>
    policy.replace("column: table:public.orders#agency_id", "column: table:public.orders#agency_ref");

  it.each([
    {
      problem: "a hierarchy cycle",
      edit: addCycle,
      ids: ["table:public.agencies", "table:public.sub_agencies", "table:public.clients"],
    },
    {
      problem: "a scopeThrough column missing from schema.json",
      edit: renameScopeColumn,
      ids: ["table:public.orders#agency_ref"],
    },
  ])("strict: $problem throws SchemaParseError naming the file and the IDs", ({ edit, ids }) => {
    const { dir, policyPath } = editedPolicy(edit);
    const caught = thrownBy(() => loadSchema(dir));
    expect(caught).toBeInstanceOf(SchemaParseError);
    const message = (caught as SchemaParseError).message;
    expect(message).toContain(policyPath);
    for (const id of ids) expect(message).toContain(id);
  });

  // An entry whose own table is gone scopes nothing: its columns went with the table, so
  // the entry is one warning and the strict load succeeds. Removing `clients` also drops
  // the parent foreign key on that root and the hierarchy edge's key on the child.
  it.each([
    {
      removed: ["table:public.orders"],
      warnings: [{ kind: "orphaned_scoped_table_id", id: "table:public.orders" }],
    },
    {
      removed: ["table:public.notes"],
      warnings: [{ kind: "orphaned_polymorphic_table_id", id: "table:public.notes" }],
    },
    {
      removed: ["table:public.clients", "table:public.appointments"],
      warnings: [
        { kind: "orphaned_root_id", id: "table:public.clients" },
        { kind: "orphaned_scoped_table_id", id: "table:public.appointments" },
      ],
    },
  ])("strict: removing $removed from schema.json leaves only table warnings, and the schema loads", ({ removed, warnings }) => {
    const dir = copyFixture(multiTenantDir);
    const schemaJsonPath = join(dir, "schema.json");
    const physical = JSON.parse(readFileSync(schemaJsonPath, "utf8")) as {
      tables: { id: string }[];
    };
    physical.tables = physical.tables.filter((t) => !removed.includes(t.id));
    writeFileSync(schemaJsonPath, JSON.stringify(physical));

    expect(loadSchema(dir).tenantPolicy!.warnings).toEqual(warnings);
  });
});

describe("loadSchema — bundles treat optional files exactly like the directory loader", () => {
  const multiTenantPhysical = () =>
    JSON.parse(readFileSync(join(multiTenantDir, "schema.json"), "utf8")) as unknown;
  const bundleJson = (extra: Record<string, unknown>) =>
    JSON.stringify({ bundled: true, physical: multiTenantPhysical(), tables: {}, ...extra });

  it("a bundle without a tenantPolicy key has no tenant policy", () => {
    expect(loadSchemaFromJson(bundleJson({})).tenantPolicy).toBeUndefined();
  });

  it("a bundle with the fixture policy matches the directory loader", () => {
    const tenantPolicy = readFileSync(join(multiTenantDir, "tenant-policy.md"), "utf8");
    expect(loadSchemaFromJson(bundleJson({ tenantPolicy })).tenantPolicy).toEqual(
      loadSchema(multiTenantDir).tenantPolicy,
    );
  });

  it("an empty tenantPolicy string throws SchemaParseError (inline JSON)", () => {
    expect(() => loadSchemaFromJson(bundleJson({ tenantPolicy: "" }))).toThrow(SchemaParseError);
  });

  it("a non-string tenantPolicy throws SchemaParseError", () => {
    expect(() => loadSchemaFromJson(bundleJson({ tenantPolicy: null }))).toThrow(SchemaParseError);
  });

  // The bundle is the file on disk, so the error must name it, not a tenant-policy.md
  // or concepts.md that does not exist.
  const fixturePolicy = () => readFileSync(join(multiTenantDir, "tenant-policy.md"), "utf8");
  it.each([
    { key: "tenantPolicy", problem: "malformed YAML", value: MALFORMED_TENANT_POLICY, file: "tenant-policy.md" },
    {
      key: "tenantPolicy",
      problem: "colliding root placeholders",
      value: () => fixturePolicy().replace("label: Sub-Agency", "label: Agency"),
      file: "tenant-policy.md",
    },
    { key: "concepts", problem: "malformed YAML", value: "---\nconcepts: [unclosed\n---\n", file: "concepts.md" },
    {
      key: "tables",
      problem: "malformed YAML",
      value: { "broken.md": "---\nid: [unclosed\n---\n" },
      file: "tables/broken.md",
    },
  ])("a $key with $problem throws SchemaParseError naming $file in the bundle file", ({ key, value, file }) => {
    const bundlePath = join(makeTempDir(), "prod.bundle.json");
    writeFileSync(bundlePath, bundleJson({ [key]: typeof value === "function" ? value() : value }));
    const caught = thrownBy(() => loadSchema(bundlePath));
    expect(caught).toBeInstanceOf(SchemaParseError);
    expect((caught as SchemaParseError).message).toContain(`${file} (in ${bundlePath})`);
  });

  it("an inline bundle's error names the file in <inline JSON>", () => {
    const caught = thrownBy(() =>
      loadSchemaFromJson(bundleJson({ tenantPolicy: MALFORMED_TENANT_POLICY })),
    );
    expect(caught).toBeInstanceOf(SchemaParseError);
    expect((caught as SchemaParseError).message).toContain("tenant-policy.md (in <inline JSON>)");
  });
});
