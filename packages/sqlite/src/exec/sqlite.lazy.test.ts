import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bs3State = vi.hoisted(() => ({
  projectResolvedPaths: new Map<string, string>(),
  shouldFail: false,
}));
vi.mock("better-sqlite3", async () => {
  if (bs3State.shouldFail) {
    const err = new Error("Cannot find package 'better-sqlite3' imported from sqlite.lazy.test.ts");
    (err as { code: string }).code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return await vi.importActual<typeof import("better-sqlite3")>("better-sqlite3");
});
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof import("node:module")>("node:module");
  return {
    ...actual,
    createRequire: (filename: string) => ({
      resolve(specifier: string) {
        const dir = dirname(filename);
        let resolved = bs3State.projectResolvedPaths.get(dir);
        if (!resolved) {
          try {
            resolved = bs3State.projectResolvedPaths.get(realpathSync.native(dir));
          } catch {
            /* dir may not exist yet */
          }
        }
        if (specifier === "better-sqlite3" && resolved) {
          return resolved;
        }
        const err = new Error(`Cannot find module '${specifier}'`);
        (err as { code: string }).code = "MODULE_NOT_FOUND";
        throw err;
      },
    }),
  };
});

const originalCwd = process.cwd();
let tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "askdb-sqlite-lazy-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  return dir;
}

async function addBetterSqlite3Fixture(projectDir: string): Promise<void> {
  const packageDir = join(projectDir, "node_modules", "better-sqlite3");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(projectDir, "package.json"),
    '{"type":"module","dependencies":{"better-sqlite3":"1.0.0"}}\n',
  );
  await writeFile(join(packageDir, "package.json"), '{"main":"index.cjs"}\n');
  bs3State.projectResolvedPaths.set(projectDir, join(packageDir, "index.cjs"));
  try {
    bs3State.projectResolvedPaths.set(realpathSync.native(projectDir), join(packageDir, "index.cjs"));
  } catch {
    /* ignore */
  }
  await writeFile(
    join(packageDir, "index.cjs"),
    `
function Database() {}
Database.prototype.prepare = function () {
  return {
    raw() {},
    all() {
      return [[1, "ok"]];
    },
    columns() {
      return [{ name: "n" }, { name: "label" }];
    }
  };
};
Database.prototype.close = function () {};
module.exports = Database;
`,
  );
}

describe("exec/sqlite - lazy `better-sqlite3` peer dependency", () => {
  beforeEach(() => {
    vi.resetModules();
    bs3State.projectResolvedPaths.clear();
    bs3State.shouldFail = false;
    process.chdir(originalCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("invoking the runner when `better-sqlite3` is missing rejects with a helpful AskDbError", async () => {
    const { createSqliteCatalogQueryRunner } = await import("./sqlite.js");
    process.chdir(await createTempProject());
    bs3State.shouldFail = true;
    const runner = createSqliteCatalogQueryRunner(":memory:");

    const err = await runner("SELECT 1").catch((e: unknown) => e);

    expect((err as Error).name).toBe("AskDbError");
    const msg = (err as Error).message;
    expect(msg).toMatch(/optional `better-sqlite3` peer dependency/);
    expect(msg).toMatch(/`pnpm add better-sqlite3`/);
    expect(msg).toMatch(/`pnpm dlx -p askdb -p better-sqlite3 askdb \.\.\.`/);
    expect(msg).toMatch(/`npx -p askdb -p better-sqlite3 askdb \.\.\.`/);
  });

  it("resolves `better-sqlite3` from the caller project cwd when the adapter import cannot see it", async () => {
    const { createSqliteCatalogQueryRunner } = await import("./sqlite.js");
    const projectDir = await createTempProject();
    await addBetterSqlite3Fixture(projectDir);
    process.chdir(projectDir);
    bs3State.shouldFail = true;

    const runner = createSqliteCatalogQueryRunner(":memory:");

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });
});
