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

describe("askdb bundle on a directory the loader accepts", () => {
  it("writes a bundle that loads to the same schema as the directory", async () => {
    const { dir, out } = copyFixture("agency-multi-tenant.schema");

    expect(await runBundleCli([dir, "--out", out])).toBe(0);
    expect(stdout).toBe(`Wrote ${out}\n`);
    expect(loadSchemaFromJson(readFileSync(out, "utf8"))).toEqual(loadSchema(dir));
  });
});
