import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mssqlState = vi.hoisted(() => ({
  imports: 0,
  projectResolvedPaths: new Map<string, string>(),
  shouldFail: false,
}));
vi.mock("mssql", async () => {
  mssqlState.imports++;
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
  beforeEach(() => {
    vi.resetModules();
    mssqlState.projectResolvedPaths.clear();
    mssqlState.shouldFail = false;
    mssqlState.imports = 0;
    process.chdir(originalCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  // Hosts build a runner without the optional peer installed; the driver must
  // not be imported until the runner is first called.
  it("createSqlServerCatalogQueryRunner() does not load `mssql` at construction time", async () => {
    const { createSqlServerCatalogQueryRunner } = await import("./sqlserver.js");
    mssqlState.shouldFail = true;

    expect(() => createSqlServerCatalogQueryRunner("mssql://nowhere")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mssqlState.imports).toBe(0);
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

  it("forwards resolveFrom through the load and installed wrappers and the catalog runner: finds `mssql` there when cwd lacks it", async () => {
    const { createSqlServerCatalogQueryRunner, loadMssqlDriver, isMssqlDriverInstalled } = await import("./sqlserver.js");
    const projectDir = await createTempProject();
    await addMssqlFixture(projectDir);
    process.chdir(await createTempProject());
    mssqlState.shouldFail = true;

    // The wrappers Studio calls must forward resolveFrom too.
    expect(isMssqlDriverInstalled({ resolveFrom: projectDir })).toBe(true);
    expect(isMssqlDriverInstalled()).toBe(false);
    await expect(loadMssqlDriver({ resolveFrom: projectDir })).resolves.toBeDefined();

    const runner = createSqlServerCatalogQueryRunner("mssql://user:pass@host:1433/db", {
      resolveFrom: projectDir,
    });
    await expect(runner("SELECT 1")).resolves.toEqual({
      columns: ["n", "label"],
      rows: [[1, "ok"]],
    });
  });
});
