import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resetAskDbRuntimeForTests } from "@askdb/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SetupError, setSetupInstallerForTests, writeSetupConfig, type SetupConfigInput } from "./setup.js";

// The planner in @askdb/config/scaffold owns the files (plan.test.ts). Studio owns its
// defaults, its relative-only path rule, and naming its own request fields in a 400.
describe("writeSetupConfig answers", () => {
  const dirs: string[] = [];
  beforeEach(() => {
    // Never run a real install; returning false also skips loading the config.
    setSetupInstallerForTests(() => false);
  });
  afterEach(() => {
    setSetupInstallerForTests(undefined);
    resetAskDbRuntimeForTests();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function projectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "askdb-setup-answers-"));
    dirs.push(dir);
    return dir;
  }

  it.each([
    ["aiKeyEnv", { database: "postgres", aiProvider: "openai", aiKeyEnv: "sk-this-looks-like-a-secret" }],
    ["studioExecuteConnectionEnv", { database: "postgres", aiProvider: "openai", studioExecute: true, studioExecuteConnectionEnv: "exec-url" }],
    ["studioExecuteProvider", { database: "prisma", aiProvider: "openai", studioExecute: true }],
    ["prismaSchema", { database: "prisma", aiProvider: "openai", prismaSchema: "./schema\n.prisma" }],
    ["schemaOut", { database: "postgres", aiProvider: "openai", schemaOut: "/srv/askdb" }],
    ["sqliteFile", { database: "sqlite", aiProvider: "openai", sqliteFile: "../outside.db" }],
  ] satisfies [string, SetupConfigInput][])("rejects a bad %s with a 400 that names it, and writes nothing", (field, input) => {
    const dir = projectDir();
    let error: unknown;
    try {
      writeSetupConfig(dir, input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SetupError);
    expect((error as SetupError).status).toBe(400);
    expect((error as SetupError).message).toMatch(new RegExp(`^\`${field}\` `));
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fills in Studio's defaults: the provider's key variable, ./data.db and ./askdb", () => {
    const dir = projectDir();
    const { envVars } = writeSetupConfig(dir, { database: "sqlite", aiProvider: "anthropic", studioExecute: true });

    const source = readFileSync(join(dir, "askdb.config.ts"), "utf8");
    expect(source.match(/file: "\.\/data\.db"/g)).toHaveLength(2);
    expect(source).toContain('outputDir: "./askdb"');
    expect(envVars.map((v) => v.name)).toEqual(["ANTHROPIC_API_KEY"]);
  });
});

// @askdb/prisma is an optional peer of Studio and askdb (#259): a Prisma project installs
// it, and pnpm 11 must approve its @prisma/engines build or the install exits 1.
//
// These run the built module in a child process without NODE_PATH: pnpm's bin shim puts
// the workspace's hoisted node_modules on NODE_PATH for the test runner, so every package
// would resolve from any directory and setup would see nothing to install.
describe("writeSetupConfig dependency install", () => {
  const repoRoot = join(import.meta.dirname, "../../..");
  const setupJs = join(import.meta.dirname, "../dist/setup.js");
  const version = (pkg: string) =>
    (JSON.parse(readFileSync(join(repoRoot, "packages", pkg, "package.json"), "utf8")) as { version: string }).version;
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * writeSetupConfig in a fresh pnpm project that already has a `node_modules`, with a
   * fake `pnpm` on PATH that reports `pnpmVersion`. The installer fails, or with `writes`
   * writes those packages into `node_modules` as `pnpm add` would and succeeds. Returns the
   * installer calls, the fallback command, and which `writes` packages the same process
   * can then resolve from the project.
   *
   * `pnpResolves` makes it a Yarn Plug'n'Play project instead: no `node_modules`, and a
   * preload that patches Node's resolver as `.pnp.cjs` does, resolving those packages.
   * `setupJs` runs another build of the module (a published layout, say). `manifest` replaces
   * the project's `package.json`, and `lockfile: false` leaves out its `pnpm-lock.yaml`.
   * `npm_config_user_agent` is cleared, so the test runner's own pnpm never picks the manager.
   */
  function setupInPnpmProject(
    input: SetupConfigInput,
    {
      pnpmVersion = "11.28.10",
      writes = [],
      pnpResolves,
      setupJs: setupModule = setupJs,
      manifest = { name: "app", private: true },
      lockfile = true,
    }: {
      pnpmVersion?: string;
      writes?: string[];
      pnpResolves?: string[];
      setupJs?: string;
      manifest?: Record<string, unknown>;
      lockfile?: boolean;
    } = {},
  ): { dir: string; calls: unknown[][]; manualInstallCommand: string | null; resolvable: boolean[] } {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "askdb-setup-install-")));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest)}\n`);
    if (lockfile) writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const preload: string[] = [];
    if (pnpResolves) {
      writeFileSync(
        join(dir, "pnp-preload.cjs"),
        `const Module = require("node:module");
        process.versions.pnp = "3";
        const names = ${JSON.stringify(pnpResolves)};
        const resolve = Module._resolveFilename;
        Module._resolveFilename = function (request, ...rest) {
          return names.includes(request) ? __filename : resolve.call(this, request, ...rest);
        };`,
      );
      preload.push("--require", join(dir, "pnp-preload.cjs"));
    } else {
      mkdirSync(join(dir, "node_modules"));
    }
    const bin = join(dir, ".fake-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh\necho ${pnpmVersion}\n`);
    chmodSync(join(bin, "pnpm"), 0o755);
    const script = `
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { createRequire } = await import("node:module");
      const { join } = await import("node:path");
      const { setSetupInstallerForTests, writeSetupConfig } = await import(${JSON.stringify(pathToFileURL(setupModule).href)});
      const dir = ${JSON.stringify(dir)};
      const writes = ${JSON.stringify(writes)};
      const calls = [];
      setSetupInstallerForTests((...args) => {
        calls.push(args);
        for (const name of writes) {
          const pkg = join(dir, "node_modules", name);
          mkdirSync(join(pkg, "dist"), { recursive: true });
          writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, type: "module", exports: { ".": "./dist/index.js" } }));
          writeFileSync(join(pkg, "dist", "index.js"), "");
        }
        return writes.length > 0;
      });
      const { manualInstallCommand } = writeSetupConfig(dir, ${JSON.stringify(input)});
      const resolvable = writes.map((name) => {
        try {
          createRequire(join(dir, "package.json")).resolve(name);
          return true;
        } catch {
          return false;
        }
      });
      console.log(JSON.stringify({ calls, manualInstallCommand, resolvable }));
    `;
    const run = spawnSync(process.execPath, [...preload, "--input-type=module", "-e", script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "", PATH: `${bin}${delimiter}${process.env.PATH}`, npm_config_user_agent: "" },
    });
    if (run.status !== 0) throw new Error(run.stderr);
    return { dir, ...JSON.parse(run.stdout) };
  }

  // `pnpm add --allow-build` arrived in pnpm 10.4.0; older pnpm rejects the unknown option.
  it.each([
    ["11.28.10", ["@prisma/engines"]],
    ["10.4.0", ["@prisma/engines"]],
    ["10.3.0", []],
    ["9.15.9", []],
  ])("installs @askdb/prisma for a Prisma source; on pnpm %s it approves %j", (pnpmVersion, allowBuilds) => {
    const { dir, calls, manualInstallCommand } = setupInPnpmProject({ database: "prisma", aiProvider: "openai" }, { pnpmVersion });

    // `ai` and `zod` at @askdb/core's ranges, which Yarn Plug'n'Play needs in the project (#760).
    const packages = [`@askdb/config@${version("config")}`, `@askdb/prisma@${version("prisma")}`, "ai@^7.0.51", "zod@^4.6.7"];
    expect(calls).toEqual([["pnpm", dir, packages, allowBuilds]]);
    expect(manualInstallCommand).toBe(["pnpm add", ...allowBuilds.map((name) => `--allow-build=${name}`), ...packages].join(" "));
  });

  // Node 24 and later keep a failed package lookup for the life of the process, so a probe
  // through Node's resolver before the install would hide the package from the load after it.
  it("leaves the packages it installs loadable from the project in the same process", () => {
    const { resolvable } = setupInPnpmProject(
      { database: "prisma", aiProvider: "openai" },
      { writes: ["@askdb/config", "@askdb/prisma", "ai", "zod"] },
    );

    expect(resolvable).toEqual([true, true, true, true]);
  });

  // A published Studio declares `^<version>`. askdb, which hosts it, may be released later
  // with a higher `@askdb/prisma` floor, so an exact pin to Studio's floor could break
  // askdb's peer range (npm exits with ERESOLVE); the range lets the install meet both.
  it("installs @askdb/prisma within a published Studio's peer range", () => {
    const studio = realpathSync(mkdtempSync(join(tmpdir(), "askdb-studio-published-")));
    dirs.push(studio);
    const studioDir = join(import.meta.dirname, "..");
    cpSync(join(studioDir, "dist"), join(studio, "dist"), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(studioDir, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
    };
    manifest.peerDependencies["@askdb/prisma"] = `^${version("prisma")}`;
    writeFileSync(join(studio, "package.json"), JSON.stringify(manifest));
    symlinkSync(join(studioDir, "node_modules"), join(studio, "node_modules"));

    const { calls } = setupInPnpmProject(
      { database: "prisma", aiProvider: "openai" },
      { setupJs: join(studio, "dist", "setup.js") },
    );

    expect(calls[0]?.[2]).toContain(`@askdb/prisma@^${version("prisma")}`);
  });

  // Yarn Plug'n'Play has no node_modules: its resolver is the only record of what's installed.
  it("installs nothing a Yarn Plug'n'Play project already resolves", () => {
    const { calls, manualInstallCommand } = setupInPnpmProject(
      { database: "postgres", aiProvider: "openai" },
      { pnpResolves: ["@askdb/config", "pg"] },
    );

    expect(calls).toEqual([]);
    expect(manualInstallCommand).toBeNull();
  });

  // #750: `pnpm init` writes devEngines.packageManager and no lockfile, and npm refuses to
  // install there (EBADDEVENGINES).
  it("installs with pnpm in a fresh `pnpm init` project with no lockfile", () => {
    const { dir, calls, manualInstallCommand } = setupInPnpmProject(
      { database: "postgres", aiProvider: "openai" },
      { lockfile: false, manifest: { name: "app", devEngines: { packageManager: { name: "pnpm", version: "12.18.0" } } } },
    );

    const packages = [`@askdb/config@${version("config")}`, "pg"];
    expect(calls).toEqual([["pnpm", dir, packages, []]]);
    expect(manualInstallCommand).toBe(`pnpm add ${packages.join(" ")}`);
  });

  it("installs no engine package and approves no build for a live engine", () => {
    const { manualInstallCommand } = setupInPnpmProject({ database: "postgres", aiProvider: "openai" });

    expect(manualInstallCommand).toBe(`pnpm add @askdb/config@${version("config")} pg`);
  });
});
