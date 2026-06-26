import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mysql2State = vi.hoisted(() => ({
  projectResolvedPaths: new Map<string, string>(),
  shouldFail: false,
}));
vi.mock("mysql2/promise", async () => {
  if (mysql2State.shouldFail) {
    const err = new Error("Cannot find package 'mysql2' imported from mysql.lazy.test.ts");
    (err as { code: string }).code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return await vi.importActual<typeof import("mysql2/promise")>("mysql2/promise");
});
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof import("node:module")>("node:module");
  return {
    ...actual,
    createRequire: (filename: string) => ({
      resolve(specifier: string) {
        const dir = dirname(filename);
        let resolved = mysql2State.projectResolvedPaths.get(dir);
        if (!resolved) {
          try {
            resolved = mysql2State.projectResolvedPaths.get(realpathSync.native(dir));
          } catch {
            /* dir may not exist yet */
          }
        }
        if (specifier === "mysql2/promise" && resolved) {
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
  const dir = await mkdtemp(join(tmpdir(), "askdb-mysql-lazy-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  return dir;
}

async function addMysql2Fixture(projectDir: string): Promise<void> {
  const packageDir = join(projectDir, "node_modules", "mysql2");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"type":"module","dependencies":{"mysql2":"1.0.0"}}\n');
  await writeFile(join(packageDir, "package.json"), '{"main":"index.cjs"}\n');
  mysql2State.projectResolvedPaths.set(projectDir, join(packageDir, "promise.js"));
  try {
    mysql2State.projectResolvedPaths.set(realpathSync.native(projectDir), join(packageDir, "promise.js"));
  } catch {
    /* ignore */
  }
  await writeFile(
    join(packageDir, "promise.js"),
    `
module.exports = {
  async createConnection() {
    return {
      async query(sql) {
        return [[{ n: 1, label: "ok" }], [{ name: "n" }, { name: "label" }]];
      },
      async end() {}
    };
  }
};
`,
  );
}

describe("exec/mysql - lazy `mysql2` peer dependency", () => {
  beforeEach(async () => {
    vi.resetModules();
    mysql2State.projectResolvedPaths.clear();
    mysql2State.shouldFail = false;
    process.chdir(originalCwd);
    const { __resetMysql2ModuleCacheForTests } = await import("./mysql.js");
    __resetMysql2ModuleCacheForTests();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("createMysqlCatalogQueryRunner() does not load `mysql2` at construction time", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    mysql2State.shouldFail = true;

    expect(() => createMysqlCatalogQueryRunner("mysql://nowhere")).not.toThrow();
  });

  it("invoking the runner when `mysql2` is missing rejects with a helpful AskDbError", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    process.chdir(await createTempProject());
    mysql2State.shouldFail = true;
    const runner = createMysqlCatalogQueryRunner("mysql://nowhere");

    const err = await runner("SELECT 1").catch((e: unknown) => e);

    expect((err as Error).name).toBe("AskDbError");
    const msg = (err as Error).message;
    expect(msg).toMatch(/optional `mysql2` peer dependency/);
    expect(msg).toMatch(/`pnpm add mysql2`/);
    expect(msg).toMatch(/`pnpm dlx -p askdb -p mysql2 askdb \.\.\.`/);
    expect(msg).toMatch(/`npx -p askdb -p mysql2 askdb \.\.\.`/);
  });

  it("after a missing-mysql2 failure, a later invocation retries the import (cache cleared)", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    process.chdir(await createTempProject());
    mysql2State.shouldFail = true;
    const runner = createMysqlCatalogQueryRunner("mysql://nowhere");

    const first = await runner("SELECT 1").catch((e: unknown) => e);
    expect((first as Error).name).toBe("AskDbError");

    const projectDir = await createTempProject();
    await addMysql2Fixture(projectDir);
    process.chdir(projectDir);

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolves `mysql2` from the caller project cwd when the adapter import cannot see it", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    const projectDir = await createTempProject();
    await addMysql2Fixture(projectDir);
    process.chdir(projectDir);
    mysql2State.shouldFail = true;

    const runner = createMysqlCatalogQueryRunner("mysql://nowhere");

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolveFrom missing-driver path rejects with AskDbError when resolveFrom has no driver", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    const emptyDir = await createTempProject();
    mysql2State.shouldFail = true;
    const runner = createMysqlCatalogQueryRunner("mysql://nowhere", { resolveFrom: emptyDir });

    const err = await runner("SELECT 1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
    expect((err as Error).message).toMatch(/optional `mysql2` peer dependency/);
  });

  it("resolveFrom honored: loads driver from resolveFrom even when cwd lacks it", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    const projectDir = await createTempProject();
    await addMysql2Fixture(projectDir);
    process.chdir(await createTempProject());
    mysql2State.shouldFail = true;

    const runner = createMysqlCatalogQueryRunner("mysql://nowhere", { resolveFrom: projectDir });
    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolveFrom cache slots are independent per directory", async () => {
    const { createMysqlCatalogQueryRunner } = await import("./mysql.js");
    const dirWithDriver = await createTempProject();
    await addMysql2Fixture(dirWithDriver);
    const dirWithoutDriver = await createTempProject();
    mysql2State.shouldFail = true;

    const runnerA = createMysqlCatalogQueryRunner("mysql://nowhere", { resolveFrom: dirWithDriver });
    await expect(runnerA("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });

    const runnerB = createMysqlCatalogQueryRunner("mysql://nowhere", { resolveFrom: dirWithoutDriver });
    const err = await runnerB("SELECT 1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
  });
});
