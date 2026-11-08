import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { integrationSuite } from "../../../../../scripts/test-utils/integration.mjs";
import { SchemaParseError } from "../../errors.js";
import { loadSchema, loadSchemaFromJson, readSchemaDirectory } from "./loader.js";

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
    expect(() => loadSchema(v1FixtureJson)).toThrow("https://askdb.tools/reference/schema-artifact-format/");
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
    // In any case: on Linux a wrong-case name escaped the check, and the copy loaded
    // with no tenant policy.
    "Tenant-Policy.md": (dir) =>
      copyFileSync(join(multiTenantDir, "tenant-policy.md"), join(dir, "Tenant-Policy.md")),
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

describe("loadSchema — a schema directory's file names must be spelled exactly", () => {
  // Renamed on disk, so readdir reports the wrong case on every filesystem. Where names
  // are case-sensitive (Linux), the loader would otherwise skip the file: no tenant
  // policy (and no tenantScope requirement), or no `sensitive: true` from tables/*.md.
  // The directory path still needs `schema.json` exactly (ADR 0019).
  it.each([
    { fixture: multiTenantDir, renames: [["tenant-policy.md", "Tenant-Policy.md"]] },
    { fixture: v2Dir, renames: [["tables", "Tables"]] },
    { fixture: v2Dir, renames: [["schema.json", "Schema.json"]] },
    // A long s: APFS stores `tableſ` and `tables` as one name, so on macOS it opened as
    // `tables/` but wasn't listed under that name.
    { fixture: v2Dir, renames: [["tables", "tableſ"]] },
    {
      // One error names them all, including a file inside the wrong-case Tables/.
      fixture: v2Dir,
      renames: [
        ["concepts.md", "Concepts.md"],
        ["tables/users.md", "tables/users.MD"],
        ["tables", "Tables"],
      ],
    },
  ])("a directory holding $renames.0.1 throws SchemaParseError naming each rename", ({ fixture, renames }) => {
    const dir = copyFixture(fixture);
    for (const [from, to] of renames) renameSync(join(dir, from!), join(dir, to!));

    const caught = thrownBy(() => loadSchema(dir));
    expect(caught).toBeInstanceOf(SchemaParseError);
    for (const [from, to] of renames) {
      expect((caught as SchemaParseError).message).toContain(`${to} to ${from}`);
    }
  });

  it("checks the same names when given the directory's schema.json path", () => {
    const dir = copyFixture(multiTenantDir);
    renameSync(join(dir, "tenant-policy.md"), join(dir, "Tenant-Policy.md"));
    expect(() => loadSchema(join(dir, "schema.json"))).toThrow(SchemaParseError);
  });
});

/** Why the temp directory can't hold two names that differ only in case, or `false`. */
const caseInsensitiveTmp = (() => {
  const dir = mkdtempSync(join(tmpdir(), "askdb-loader-case-"));
  try {
    writeFileSync(join(dir, "a"), "");
    return existsSync(join(dir, "A")) && "the temp directory's filesystem ignores case (macOS and Windows defaults)";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

integrationSuite({ unavailable: caseInsensitiveTmp })(
  "loadSchema — both spellings of a name, on a case-sensitive filesystem",
  () => {
    // Renaming one spelling onto the other would overwrite tenant-policy.md or move
    // Tables/ inside tables/, where the loader never looks, so the error says to keep one.
    it.each([
      { fixture: multiTenantDir, exact: "tenant-policy.md", wrong: "Tenant-Policy.md" },
      { fixture: v2Dir, exact: "tables", wrong: "Tables" },
      { fixture: v2Dir, exact: "tables/users.md", wrong: "tables/users.MD" },
    ])("$wrong beside $exact throws SchemaParseError saying to keep one", ({ fixture, exact, wrong }) => {
      const dir = copyFixture(fixture);
      cpSync(join(dir, exact), join(dir, wrong), { recursive: true });

      const caught = thrownBy(() => loadSchema(dir));
      expect(caught).toBeInstanceOf(SchemaParseError);
      expect((caught as SchemaParseError).message).toContain(
        `keep one of ${wrong}, ${exact}, named ${exact}`,
      );
    });
  },
);

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

  it("a tenant-policy.md link whose target is missing throws SchemaParseError, not no policy", () => {
    // The directory lists the file, so it is present; reading it fails with ENOENT,
    // which must not count as "absent" here.
    const dir = copyFixture(multiTenantDir);
    rmSync(join(dir, "tenant-policy.md"));
    symlinkSync("deleted-policy.md", join(dir, "tenant-policy.md"));
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
  const moveScopeColumn = (policy: string) =>
    policy.replace("column: table:public.orders#agency_id", "column: table:public.clients#sub_agency_id");

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
    {
      problem: "a scopeThrough column on another table (#836)",
      edit: moveScopeColumn,
      ids: ["column table:public.clients#sub_agency_id is on table:public.clients"],
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

describe("loadSchema — a bundle's tables must be an object of table markdown (#797)", () => {
  /** A bundle with the fixture's physical layer and `tables` as given; `undefined` leaves the key out. */
  const bundleWithTables = (tables: unknown) =>
    JSON.stringify({
      bundled: true,
      physical: JSON.parse(readFileSync(v2SchemaJson, "utf8")) as unknown,
      ...(tables === undefined ? {} : { tables }),
    });
  const NOT_AN_OBJECT =
    "`tables` must be an object keyed by tables/*.md file name, with each file's raw markdown as the value.";

  it.each([
    {
      problem: "missing",
      tables: undefined,
      reason: "`tables` is missing; a bundle carries every tables/*.md as an object keyed by file name ({} when there are none).",
    },
    { problem: "null", tables: null, reason: NOT_AN_OBJECT },
    { problem: "a string", tables: "orders.md", reason: NOT_AN_OBJECT },
    { problem: "an array", tables: ["---\nid: table:public.orders\n---\n"], reason: NOT_AN_OBJECT },
    // These two loaded as a schema with no table files before #797.
    { problem: "an empty string", tables: "", reason: NOT_AN_OBJECT },
    { problem: "an empty array", tables: [], reason: NOT_AN_OBJECT },
    {
      problem: "an object with a non-string file",
      // gray-matter would take this object as an already-parsed file and keep its `data`.
      tables: { "orders.md": { content: "---\n---\n", data: { id: "table:public.orders", aliases: ["x"] } } },
      reason: "`tables` entry orders.md must be the raw tables/orders.md content (a string).",
    },
  ])("a bundle whose tables is $problem throws SchemaParseError naming tables and the bundle", ({ tables, reason }) => {
    const inline = thrownBy(() => loadSchemaFromJson(bundleWithTables(tables)));
    expect(inline).toBeInstanceOf(SchemaParseError);
    expect((inline as SchemaParseError).message).toBe(`Invalid bundle at <inline JSON>: ${reason}`);

    const bundlePath = join(makeTempDir(), "prod.bundle.json");
    writeFileSync(bundlePath, bundleWithTables(tables));
    const fromFile = thrownBy(() => loadSchema(bundlePath));
    expect(fromFile).toBeInstanceOf(SchemaParseError);
    expect((fromFile as SchemaParseError).message).toBe(`Invalid bundle at ${bundlePath}: ${reason}`);
  });
});

describe("readSchemaDirectory", () => {
  const ORDERS_USERS_TENANT_POLICY = [
    "---",
    "schemaId: orders-users",
    "enforcement: strict",
    "roots:",
    "  - id: table:public.users",
    "    tenantIdColumn: table:public.users#id",
    "    label: User",
    "scopedTables:",
    "  - id: table:public.orders",
    "    scopeThrough:",
    "      - root: table:public.users",
    "        column: table:public.orders#user_id",
    "---",
    "",
  ].join("\n");

  it("returns a bundle that loadSchemaFromJson loads to the same schema as loadSchema(dir)", () => {
    // orders-users has tables/ and concepts.md; the written policy makes all three optional parts present.
    const dir = copyFixture(v2Dir);
    writeFileSync(join(dir, "tenant-policy.md"), ORDERS_USERS_TENANT_POLICY);
    const viaDir = loadSchema(dir);
    expect(viaDir.tenantPolicy).toBeDefined();
    expect(viaDir.concepts).not.toHaveLength(0);
    expect(viaDir.tables.find((t) => t.name === "users")?.aliases).toEqual(["accounts", "members"]);

    expect(loadSchemaFromJson(JSON.stringify(readSchemaDirectory(dir)))).toEqual(viaDir);
  });
});

describe("loadSchema — business context and column notes (#898)", () => {
  const BIZ = "Orders move through `pending → paid → shipped` and may end in `cancelled`. The `total_amount` column is stored in cents.";
  function withNotes(): string {
    const dir = copyFixture(v2Dir);
    const orders = join(dir, "tables/orders.md");
    writeFileSync(orders, `${readFileSync(orders, "utf8")}\n## Column notes\n\n- \`status\`: refunds flip a paid order back to pending\n- \`total_amount\` — includes tax\n- \`id\` - surrogate key\n`);
    const users = join(dir, "tables/users.md");
    writeFileSync(users, `${readFileSync(users, "utf8")}\n## Column notes\n\n- \`email\`: lowercased on write\n`);
    return dir;
  }
  const table = (schema: ReturnType<typeof loadSchema>, name: string) => schema.tables.find((t) => t.name === name)!;
  const column = (schema: ReturnType<typeof loadSchema>, tableName: string, name: string) =>
    table(schema, tableName).columns.find((c) => c.name === name)!;

  it("fills a table's businessContext and each column's note from its table file", () => {
    const schema = loadSchema(withNotes());
    expect(table(schema, "orders").businessContext).toBe(BIZ);
    expect(column(schema, "orders", "status").note).toBe("refunds flip a paid order back to pending");
    expect(column(schema, "orders", "total_amount").note).toBe("includes tax");
    expect(column(schema, "orders", "id").note).toBe("surrogate key");
    expect(column(schema, "orders", "user_id").note).toBeUndefined();
  });

  it("leaves out a sensitive column's note, as it leaves out its description", () => {
    expect(column(loadSchema(withNotes()), "users", "email").note).toBeUndefined();
  });

  it("leaves out a sensitive table's business context and its columns' notes", () => {
    const dir = withNotes();
    const orders = join(dir, "tables/orders.md");
    writeFileSync(orders, readFileSync(orders, "utf8").replace("schemaId: orders-users\n", "schemaId: orders-users\nsensitive: true\n"));
    const schema = loadSchema(dir);
    expect(table(schema, "orders").sensitive).toBe(true);
    expect(table(schema, "orders").businessContext).toBeUndefined();
    expect(table(schema, "orders").columns.map((c) => c.note)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("never takes a table's description from a recognized section, even when the file has no heading before it", () => {
    const dir = withNotes();
    const users = join(dir, "tables/users.md");
    const frontMatter = readFileSync(users, "utf8").split("\n---\n")[0];
    writeFileSync(users, `${frontMatter}\n---\n\n## Column notes\n\n- \`email\`: personal addresses are hashed nightly\n`);
    const schema = loadSchema(dir);
    expect(table(schema, "users").description).toBeUndefined();
    expect(column(schema, "users", "email").note).toBeUndefined();
  });
});

describe("loadSchema — unknown keys in schema.json warn (#690)", () => {
  /** A copy of the orders-users fixture with `edit` applied to its parsed `schema.json`. */
  function withSchemaJson(edit: (json: Record<string, any>) => void): string {
    const dir = copyFixture(v2Dir);
    const file = join(dir, "schema.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    edit(json);
    writeFileSync(file, JSON.stringify(json, null, 2));
    return dir;
  }
  const unknownKeys = (schema: ReturnType<typeof loadSchema>) => schema.warnings.filter((w) => w.kind === "unknown_key");

  it("names a misspelled column flag and its column, suggests the known key, and leaves the column unprotected", () => {
    const dir = withSchemaJson((json) => {
      const created = json.tables[0].columns.find((c: { name: string }) => c.name === "created_at");
      created.sensitve = true;
    });
    const schema = loadSchema(dir);
    expect(unknownKeys(schema)).toEqual([
      { kind: "unknown_key", id: "table:public.users#created_at", key: "sensitve", suggestion: "sensitive" },
    ]);
    expect(schema.tables[0]!.columns.find((c) => c.name === "created_at")!.sensitive).toBe(false);
  });

  it("warns on unknown table, relationship and top-level keys, suggesting a key that differs only in case", () => {
    const dir = withSchemaJson((json) => {
      json.schemaID = "typo";
      json.tables[1].Sensitive = true;
      json.tables[1].relationships[0].note = "orders belong to users";
      json.tables[1].columns[0].comment = "from the DDL";
    });
    expect(unknownKeys(loadSchema(dir))).toEqual([
      { kind: "unknown_key", id: "schema.json", key: "schemaID", suggestion: "schemaId" },
      { kind: "unknown_key", id: "table:public.orders", key: "Sensitive", suggestion: "sensitive" },
      { kind: "unknown_key", id: "table:public.orders#id", key: "comment" },
      { kind: "unknown_key", id: "table:public.orders#user_id->table:public.users#id", key: "note" },
    ]);
  });

  it("warns the same from a bare schema.json, a directory and its bundle", () => {
    const dir = withSchemaJson((json) => {
      json.tables[0].columns[0].nulable = false;
    });
    const expected = [{ kind: "unknown_key", id: "table:public.users#id", key: "nulable", suggestion: "nullable" }];
    expect(unknownKeys(loadSchema(dir))).toEqual(expected);
    expect(unknownKeys(loadSchemaFromJson(readFileSync(join(dir, "schema.json"), "utf8")))).toEqual(expected);
    expect(unknownKeys(loadSchemaFromJson(JSON.stringify(readSchemaDirectory(dir))))).toEqual(expected);
  });

  it("adds no warning for a schema.json with only known keys", () => {
    expect(unknownKeys(loadSchema(v2Dir))).toEqual([]);
    expect(unknownKeys(loadSchema(multiTenantDir))).toEqual([]);
  });
});

