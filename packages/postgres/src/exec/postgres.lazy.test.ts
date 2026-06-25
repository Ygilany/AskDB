import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock `pg` so we can simulate "peer dep missing" without uninstalling the workspace dev dep.
// `vi.hoisted` is required because `vi.mock` is hoisted to the top of the file before imports.
const pgState = vi.hoisted(() => ({ projectResolvedPath: undefined as string | undefined, shouldFail: false }));
vi.mock("pg", async () => {
  if (pgState.shouldFail) {
    const err = new Error("Cannot find package 'pg' imported from postgres.lazy.test.ts");
    (err as { code: string }).code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return await vi.importActual<typeof import("pg")>("pg");
});
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof import("node:module")>("node:module");
  return {
    ...actual,
    createRequire: () => ({
      resolve(specifier: string) {
        if (specifier === "pg" && pgState.projectResolvedPath) return pgState.projectResolvedPath;
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
  const dir = await mkdtemp(join(tmpdir(), "askdb-pg-lazy-"));
  tempDirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  return dir;
}

async function addPgFixture(projectDir: string): Promise<void> {
  const packageDir = join(projectDir, "node_modules", "pg");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), '{"type":"module","dependencies":{"pg":"1.0.0"}}\n');
  await writeFile(join(packageDir, "package.json"), '{"main":"index.cjs"}\n');
  pgState.projectResolvedPath = join(packageDir, "index.cjs");
  await writeFile(
    join(packageDir, "index.cjs"),
    `
class Pool {
  async connect() {
    return {
      async query(sql) {
        if (sql === "SELECT 1") {
          return { fields: [{ name: "n" }], rows: [{ n: 1 }] };
        }
        return { fields: [], rows: [] };
      },
      release() {}
    };
  }
  async end() {}
}
module.exports = { Pool };
`,
  );
}

describe("exec/postgres — lazy `pg` peer dependency", () => {
  beforeEach(async () => {
    vi.resetModules();
    pgState.projectResolvedPath = undefined;
    pgState.shouldFail = false;
    process.chdir(originalCwd);
    const { __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("createPostgresCatalogQueryRunner() does not load `pg` at construction time", async () => {
    const { createPostgresCatalogQueryRunner } = await import("./postgres.js");
    pgState.shouldFail = true;

    expect(() => createPostgresCatalogQueryRunner("postgres://nowhere")).not.toThrow();
  });

  it("invoking the runner when `pg` is missing rejects with a helpful AskDbError", async () => {
    const { createPostgresCatalogQueryRunner, __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
    process.chdir(await createTempProject());
    pgState.shouldFail = true;
    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    const err = await runner("SELECT 1").catch((e: unknown) => e);

    expect((err as Error).name).toBe("AskDbError");
    const msg = (err as Error).message;
    expect(msg).toMatch(/optional `pg` peer dependency/);
    expect(msg).toMatch(/`pnpm add pg`/);
    expect(msg).toMatch(/`pnpm dlx -p askdb -p pg askdb \.\.\.`/);
    expect(msg).toMatch(/`npx -p askdb -p pg askdb \.\.\.`/);
    expect(msg).toMatch(/catalog query runner/);
  });

  it("after a missing-pg failure, a later invocation retries the import (cache cleared)", async () => {
    const { createPostgresCatalogQueryRunner, __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
    process.chdir(await createTempProject());
    pgState.shouldFail = true;
    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    const first = await runner("SELECT 1").catch((e: unknown) => e);
    expect((first as Error).name).toBe("AskDbError");

    const projectDir = await createTempProject();
    await addPgFixture(projectDir);
    process.chdir(projectDir);

    await expect(runner("SELECT 1")).resolves.toEqual({ columns: ["n"], rows: [[1]] });
  });

  it("resolves `pg` from the caller project cwd when the adapter import cannot see it", async () => {
    const { createPostgresCatalogQueryRunner, __resetPgModuleCacheForTests } = await import("./postgres.js");
    __resetPgModuleCacheForTests();
    const projectDir = await createTempProject();
    await addPgFixture(projectDir);
    process.chdir(projectDir);
    pgState.shouldFail = true;

    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    await expect(runner("SELECT 1")).resolves.toEqual({ columns: ["n"], rows: [[1]] });
  });
});
