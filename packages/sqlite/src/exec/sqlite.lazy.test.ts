import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bs3State = vi.hoisted(() => ({
  projectResolvedPath: undefined as string | undefined,
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
    createRequire: () => ({
      resolve(specifier: string) {
        if (specifier === "better-sqlite3" && bs3State.projectResolvedPath) {
          return bs3State.projectResolvedPath;
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
  bs3State.projectResolvedPath = join(packageDir, "index.cjs");
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
  beforeEach(async () => {
    vi.resetModules();
    bs3State.projectResolvedPath = undefined;
    bs3State.shouldFail = false;
    process.chdir(originalCwd);
    const { __resetBetterSqlite3ModuleCacheForTests } = await import("./sqlite.js");
    __resetBetterSqlite3ModuleCacheForTests();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("createSqliteCatalogQueryRunner() does not load `better-sqlite3` at construction time", async () => {
    const { createSqliteCatalogQueryRunner } = await import("./sqlite.js");
    bs3State.shouldFail = true;

    expect(() => createSqliteCatalogQueryRunner(":memory:")).not.toThrow();
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

  it("after a missing-better-sqlite3 failure, a later invocation retries the import (cache cleared)", async () => {
    const { createSqliteCatalogQueryRunner } = await import("./sqlite.js");
    process.chdir(await createTempProject());
    bs3State.shouldFail = true;
    const runner = createSqliteCatalogQueryRunner(":memory:");

    const first = await runner("SELECT 1").catch((e: unknown) => e);
    expect((first as Error).name).toBe("AskDbError");

    const projectDir = await createTempProject();
    await addBetterSqlite3Fixture(projectDir);
    process.chdir(projectDir);

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
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
