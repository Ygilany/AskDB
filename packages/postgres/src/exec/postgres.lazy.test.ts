import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock `pg` so we can simulate "peer dep missing" without uninstalling the workspace dev dep.
// `vi.hoisted` is required because `vi.mock` is hoisted to the top of the file before imports.
const pgState = vi.hoisted(() => ({
  imports: 0,
  projectResolvedPaths: new Map<string, string>(),
  shouldFail: false,
}));
vi.mock("pg", async () => {
  pgState.imports++;
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
    createRequire: (filename: string) => ({
      resolve(specifier: string) {
        const dir = dirname(filename);
        let resolved = pgState.projectResolvedPaths.get(dir);
        if (!resolved) {
          try {
            resolved = pgState.projectResolvedPaths.get(realpathSync.native(dir));
          } catch {
            /* dir may not exist yet */
          }
        }
        if (specifier === "pg" && resolved) return resolved;
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
  pgState.projectResolvedPaths.set(projectDir, join(packageDir, "index.cjs"));
  try {
    pgState.projectResolvedPaths.set(realpathSync.native(projectDir), join(packageDir, "index.cjs"));
  } catch {
    /* ignore */
  }
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
  beforeEach(() => {
    vi.resetModules();
    pgState.projectResolvedPaths.clear();
    pgState.shouldFail = false;
    pgState.imports = 0;
    process.chdir(originalCwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  // Hosts build a runner without the optional peer installed; the driver must
  // not be imported until the runner is first called.
  it("createPostgresCatalogQueryRunner() does not load `pg` at construction time", async () => {
    const { createPostgresCatalogQueryRunner } = await import("./postgres.js");
    pgState.shouldFail = true;

    expect(() => createPostgresCatalogQueryRunner("postgres://nowhere")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pgState.imports).toBe(0);
  });

  it("invoking the runner when `pg` is missing rejects with a helpful AskDbError", async () => {
    const { createPostgresCatalogQueryRunner } = await import("./postgres.js");
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

  it("resolves `pg` from the caller project cwd when the adapter import cannot see it", async () => {
    const { createPostgresCatalogQueryRunner } = await import("./postgres.js");
    const projectDir = await createTempProject();
    await addPgFixture(projectDir);
    process.chdir(projectDir);
    pgState.shouldFail = true;

    const runner = createPostgresCatalogQueryRunner("postgres://nowhere");

    await expect(runner("SELECT 1")).resolves.toEqual({ columns: ["n"], rows: [[1]] });
  });

  it("forwards resolveFrom through the load and installed wrappers and the catalog runner: finds `pg` there when cwd lacks it", async () => {
    const { createPostgresCatalogQueryRunner, loadPgDriver, isPgDriverInstalled } = await import("./postgres.js");
    const projectDir = await createTempProject();
    await addPgFixture(projectDir);
    process.chdir(await createTempProject());
    pgState.shouldFail = true;

    // The wrappers Studio calls must forward resolveFrom too.
    expect(isPgDriverInstalled({ resolveFrom: projectDir })).toBe(true);
    expect(isPgDriverInstalled()).toBe(false);
    await expect(loadPgDriver({ resolveFrom: projectDir })).resolves.toBeDefined();

    const runner = createPostgresCatalogQueryRunner("postgres://nowhere", { resolveFrom: projectDir });
    await expect(runner("SELECT 1")).resolves.toEqual({ columns: ["n"], rows: [[1]] });
  });
});
