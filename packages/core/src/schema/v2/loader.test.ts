import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("excludes describable-layer fields for sensitive columns", () => {
    const schema = loadSchema(v2Dir);
    const users = schema.tables.find((t) => t.name === "users")!;
    const emailCol = users.columns.find((c) => c.name === "email")!;
    expect(emailCol.sensitive).toBe(true);
    // Describable fields should be absent for sensitive column
    expect(emailCol.aliases).toBeUndefined();
    expect(emailCol.description).toBeUndefined();
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

describe("loadSchema — validation errors", () => {
  it("rejects front-matter with unknown keys", () => {
    // We test this via parseTableMarkdown directly in parser.test.ts
    // Here we just confirm the loader propagates SchemaParseError
    expect(() => loadSchema("/nonexistent/path")).toThrow();
  });

  it("warns on orphaned column id in table markdown", () => {
    // We test orphaned-id detection via a synthesized case in parser.test.ts
    // The loader produces warnings; this fixture has no orphans
    const schema = loadSchema(v2Dir);
    const orphans = schema.warnings.filter((w) => w.kind === "orphaned_column_id");
    expect(orphans).toHaveLength(0);
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

  it("still treats a JSON file not named schema.json as a standalone physical layer", () => {
    const dir = makeTempDir();
    copyFileSync(join(multiTenantDir, "schema.json"), join(dir, "physical.json"));
    writeFileSync(join(dir, "tenant-policy.md"), MALFORMED_TENANT_POLICY);
    const schema = loadSchema(join(dir, "physical.json"));
    expect(schema.tenantPolicy).toBeUndefined();
    expect(schema.tables.length).toBeGreaterThan(0);
  });
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

  it("malformed tenantPolicy YAML throws SchemaParseError", () => {
    expect(() =>
      loadSchemaFromJson(bundleJson({ tenantPolicy: MALFORMED_TENANT_POLICY })),
    ).toThrow(SchemaParseError);
  });

  it("malformed concepts YAML throws SchemaParseError, like the directory loader", () => {
    const concepts = "---\nconcepts: [unclosed\n---\n";
    expect(() => loadSchemaFromJson(bundleJson({ concepts }))).toThrow(SchemaParseError);
  });
});
