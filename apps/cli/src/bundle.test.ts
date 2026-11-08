/**
 * `askdb bundle` refuses a schema directory that `loadSchema()` refuses, before it writes
 * anything, so a bundle it writes always loads (#796).
 *
 * Contract: `reference/cli.mdx`, `askdb bundle`: the command checks the directory with the loader
 * `ask()` uses and exits 1 with that loader's error, writing nothing; a bundle it writes loads.
 * Catches: a bundle written from markdown the loader refuses (front-matter that isn't YAML, a
 * broken tenant policy, two table files with one `id`), which used to fail only when the service
 * loaded it, and a failed run that leaves a file at `--out`, or overwrites the one there.
 * Not covered elsewhere: `spawn-first-run.test.ts` runs `bundle` once on a good fixture; nothing
 * ran it on a directory the loader refuses.
 * Seam: none. The command runs through `runBundleCli`, on copies of the repo's fixtures.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchema, loadSchemaFromJson } from "@askdb/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBundleCli } from "./bundle.js";

/**
 * When set, the directory read hands back what it read with one table file replaced, as if the
 * file changed between the bundler's read and its check: the only way to reach the check's
 * fallback, where the directory on disk loads but the bundle doesn't.
 */
const changedBetweenReads = vi.hoisted(() => ({ table: undefined as string | undefined }));

vi.mock("@askdb/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askdb/core")>();
  return {
    ...actual,
    readSchemaDirectory: (dir: string) => {
      const bundle = actual.readSchemaDirectory(dir);
      const { table } = changedBetweenReads;
      return table === undefined ? bundle : { ...bundle, tables: { ...bundle.tables, "orders.md": table } };
    },
  };
});

const fixtures = join(import.meta.dirname, "../../../fixtures/schemas");

let stdout = "";
let stderr = "";
const tempDirs: string[] = [];

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  changedBetweenReads.table = undefined;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of a fixture schema directory, and a path beside it for the bundle. */
function copyFixture(name: string): { dir: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), "askdb-bundle-"));
  tempDirs.push(root);
  const dir = join(root, name);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return { dir, out: join(root, "out.bundle.json") };
}

/** The error `loadSchema()` throws for the directory: the one `askdb bundle` must print. */
function loaderError(dir: string): string {
  try {
    loadSchema(dir);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected loadSchema() to refuse ${dir}`);
}

/** A table file whose front-matter isn't YAML, which the loader refuses (GHSA-qqx9-qpw2-wcqg). */
const NON_YAML_TABLE = "---js\n{ id: 'table:public.orders' }\n---\n";
const MALFORMED_TENANT_POLICY = "---\nschemaId: agency-multi-tenant\nenforcement: strict\nroots:\n  - id: [unclosed\n---\n";

describe("askdb bundle refuses a directory the loader refuses", () => {
  it.each([
    {
      problem: "a table file whose front-matter isn't YAML",
      fixture: "orders-users.schema",
      breakIt: (dir: string) => writeFileSync(join(dir, "tables", "orders.md"), NON_YAML_TABLE),
    },
    {
      problem: "a tenant-policy.md that doesn't parse",
      fixture: "agency-multi-tenant.schema",
      breakIt: (dir: string) => writeFileSync(join(dir, "tenant-policy.md"), MALFORMED_TENANT_POLICY),
    },
    {
      problem: "two table files with the same id",
      fixture: "orders-users.schema",
      breakIt: (dir: string) => cpSync(join(dir, "tables", "orders.md"), join(dir, "tables", "orders-copy.md")),
    },
  ])("$problem: exits 1 with the loader's error and writes nothing", async ({ fixture, breakIt }) => {
    const { dir, out } = copyFixture(fixture);
    breakIt(dir);

    expect(await runBundleCli([dir, "--out", out])).toBe(1);
    expect(stderr).toBe(`askdb bundle: ${loaderError(dir)}\n`);
    expect(stdout).toBe("");
    expect(existsSync(out)).toBe(false);
  });

  it("leaves a file already at --out as it was", async () => {
    const { dir, out } = copyFixture("orders-users.schema");
    writeFileSync(join(dir, "tables", "orders.md"), NON_YAML_TABLE);
    writeFileSync(out, "the previous bundle\n");

    expect(await runBundleCli([dir, "--out", out])).toBe(1);
    expect(readFileSync(out, "utf8")).toBe("the previous bundle\n");
  });
});

describe("askdb bundle when a file changes between the read and the check", () => {
  it("still exits 1 and writes nothing when the directory loads but the bundle doesn't", async () => {
    const { dir, out } = copyFixture("orders-users.schema");
    changedBetweenReads.table = NON_YAML_TABLE;
    expect(() => loadSchema(dir)).not.toThrow();

    expect(await runBundleCli([dir, "--out", out])).toBe(1);
    // The bundle's own error: the file on disk loads, so the loader can only name the bundled copy.
    expect(stderr).toMatch(/^askdb bundle: Malformed table front-matter YAML in tables\/orders\.md \(in <inline JSON>\): /);
    expect(stdout).toBe("");
    expect(existsSync(out)).toBe(false);
  });
});

describe("askdb bundle on a directory the loader accepts", () => {
  it("writes a bundle that loads to the same schema as the directory", async () => {
    const { dir, out } = copyFixture("agency-multi-tenant.schema");

    expect(await runBundleCli([dir, "--out", out])).toBe(0);
    expect(stdout).toBe(`Wrote ${out}\n`);
    expect(loadSchemaFromJson(readFileSync(out, "utf8"))).toEqual(loadSchema(dir));
  });
});

describe("askdb bundle prints the loader's warnings on stderr", () => {
  it("writes the bundle and prints each warning as one line, a tenant policy's included", async () => {
    const { dir, out } = copyFixture("agency-multi-tenant.schema");
    const policy = join(dir, "tenant-policy.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("  - table:public.service_types\n", "  - table:public.service_types\n  - table:public.gone\n"));

    expect(await runBundleCli([dir, "--out", out])).toBe(0);
    expect(stdout).toBe(`Wrote ${out}\n`);
    expect(stderr).toBe("Warning: tenant-policy.md: global table table:public.gone is not in schema.json\n");
  });

  it("prints a table file's warning", async () => {
    const { dir, out } = copyFixture("orders-users.schema");
    const orders = join(dir, "tables/orders.md");
    writeFileSync(
      orders,
      readFileSync(orders, "utf8").replace(
        "  - id: table:public.orders#status\n",
        "  - id: table:public.users#id\n    sensitive: true\n  - id: table:public.orders#status\n",
      ),
    );

    expect(await runBundleCli([dir, "--out", out])).toBe(0);
    expect(stderr).toBe(
      "Warning: tables/orders.md lists column table:public.users#id, which is on table:public.users; only its sensitive: true applies, so move the entry to that table's file\n",
    );
  });
});

