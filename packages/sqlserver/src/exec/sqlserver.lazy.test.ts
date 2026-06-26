import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mssqlState = vi.hoisted(() => ({
  projectResolvedPaths: new Map<string, string>(),
  shouldFail: false,
}));
vi.mock("mssql", async () => {
  if (mssqlState.shouldFail) {
    const err = new Error("Cannot find package 'mssql' imported from sqlserver.lazy.test.ts");
    (err as { code: string }).code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return await vi.importActual<typeof import("mssql")>("mssql");
});
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof import("node:module")>("node:module");
  return {
    ...actual,
    createRequire: (filename: string) => ({
      resolve(specifier: string) {
        const dir = dirname(filename);
        let resolved = mssqlState.projectResolvedPaths.get(dir);
        if (!resolved) {
          try {
            resolved = mssqlState.projectResolvedPaths.get(realpathSync.native(dir));
          } catch {
            /* dir may not exist yet */
          }
        }
        if (specifier === "mssql" && resolved) return resolved;
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
  const dir = await mkdtemp(join(tmpdir(), "askdb-sqlserver-lazy-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  return dir;
}

async function addMssqlFixture(projectDir: string): Promise<void> {
  const packageDir = join(projectDir, "node_modules", "mssql");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"type":"module","dependencies":{"mssql":"1.0.0"}}\n');
  await writeFile(join(packageDir, "package.json"), '{"main":"index.cjs"}\n');
  mssqlState.projectResolvedPaths.set(projectDir, join(packageDir, "index.cjs"));
  try {
    mssqlState.projectResolvedPaths.set(realpathSync.native(projectDir), join(packageDir, "index.cjs"));
  } catch {
    /* ignore */
  }
  await writeFile(
    join(packageDir, "index.cjs"),
    `
class ConnectionPool {
  async connect() {}
  request() {
    return {
      input() {
        return this;
      },
      async query() {
        return { recordset: [{ n: 1, label: "ok" }] };
      }
    };
  }
  async close() {}
}
module.exports = { ConnectionPool };
`,
  );
}

describe("exec/sqlserver - lazy `mssql` peer dependency", () => {
  beforeEach(async () => {
    vi.resetModules();
    mssqlState.projectResolvedPaths.clear();
    mssqlState.shouldFail = false;
    process.chdir(originalCwd);
    const { __resetMssqlModuleCacheForTests } = await import("./sqlserver.js");
    __resetMssqlModuleCacheForTests();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("createSqlServerCatalogQueryRunner() does not load `mssql` at construction time", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    mssqlState.shouldFail = true;

    expect(() => createSqlServerCatalogQueryRunner("mssql://nowhere")).not.toThrow();
  });

  it("invoking the runner when `mssql` is missing rejects with a helpful AskDbError", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    process.chdir(await createTempProject());
    mssqlState.shouldFail = true;
    const runner = createSqlServerCatalogQueryRunner("mssql://nowhere");

    const err = await runner("SELECT 1").catch((e: unknown) => e);

    expect((err as Error).name).toBe("AskDbError");
    const msg = (err as Error).message;
    expect(msg).toMatch(/optional `mssql` peer dependency/);
    expect(msg).toMatch(/`pnpm add mssql`/);
    expect(msg).toMatch(/`pnpm dlx -p askdb -p mssql askdb \.\.\.`/);
    expect(msg).toMatch(/`npx -p askdb -p mssql askdb \.\.\.`/);
  });

  it("after a missing-mssql failure, a later invocation retries the import (cache cleared)", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    process.chdir(await createTempProject());
    mssqlState.shouldFail = true;
    const runner = createSqlServerCatalogQueryRunner("mssql://nowhere");

    const first = await runner("SELECT 1").catch((e: unknown) => e);
    expect((first as Error).name).toBe("AskDbError");

    const projectDir = await createTempProject();
    await addMssqlFixture(projectDir);
    process.chdir(projectDir);

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolves `mssql` from the caller project cwd when the adapter import cannot see it", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    const projectDir = await createTempProject();
    await addMssqlFixture(projectDir);
    process.chdir(projectDir);
    mssqlState.shouldFail = true;

    const runner = createSqlServerCatalogQueryRunner("mssql://nowhere");

    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolveFrom missing-driver path rejects with AskDbError when resolveFrom has no driver", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    const emptyDir = await createTempProject();
    mssqlState.shouldFail = true;
    const runner = createSqlServerCatalogQueryRunner("mssql://nowhere", { resolveFrom: emptyDir });

    const err = await runner("SELECT 1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
    expect((err as Error).message).toMatch(/optional `mssql` peer dependency/);
  });

  it("resolveFrom honored: loads driver from resolveFrom even when cwd lacks it", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    const projectDir = await createTempProject();
    await addMssqlFixture(projectDir);
    process.chdir(await createTempProject());
    mssqlState.shouldFail = true;

    const runner = createSqlServerCatalogQueryRunner("mssql://user:pass@host:1433/db", {
      resolveFrom: projectDir,
    });
    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });

  it("resolveFrom cache slots are independent per directory", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    const dirWithDriver = await createTempProject();
    await addMssqlFixture(dirWithDriver);
    const dirWithoutDriver = await createTempProject();
    mssqlState.shouldFail = true;

    const runnerA = createSqlServerCatalogQueryRunner("mssql://user:pass@host:1433/db", {
      resolveFrom: dirWithDriver,
    });
    await expect(runnerA("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });

    const runnerB = createSqlServerCatalogQueryRunner("mssql://user:pass@host:1433/db", {
      resolveFrom: dirWithoutDriver,
    });
    const err = await runnerB("SELECT 1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("AskDbError");
  });
});
