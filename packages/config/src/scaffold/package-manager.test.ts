import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectPackageManager,
  findNearestPackageJsonDir,
  isLikelyWorkspaceRoot,
  packageManagerSpawnSpec,
} from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temp directory holding `files` (relative path → contents). */
function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "askdb-scaffold-pm-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), contents, "utf8");
  }
  return root;
}

describe("findNearestPackageJsonDir", () => {
  it("finds a package.json in a parent directory", () => {
    const root = project({ "package.json": "{}\n" });
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findNearestPackageJsonDir(nested)).toBe(root);
  });

  it("returns undefined when there is none", () => {
    const root = project();
    expect(findNearestPackageJsonDir(join(root, "x"))).toBeUndefined();
  });
});

describe("isLikelyWorkspaceRoot", () => {
  const pkg = '{"name":"r","private":true}\n';
  it.each([
    ["a pnpm-workspace.yaml that lists packages", true, { "package.json": pkg, "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n' }],
    ["a pnpm-workspace.yaml with a flow list of packages", true, { "package.json": pkg, "pnpm-workspace.yaml": "packages: [apps/*, packages/*]\n" }],
    ["a pnpm-workspace.yaml whose packages list follows comments and settings", true, { "package.json": pkg, "pnpm-workspace.yaml": "# Workspace\nminimumReleaseAge: 720\npackages:\n  # apps first\n\n  - apps/*\n" }],
    ["a pnpm-workspace.yml that lists packages", true, { "package.json": pkg, "pnpm-workspace.yml": "packages:\n- packages/*\n" }],
    ["a pnpm-workspace.yaml with CR line breaks that lists packages", true, { "package.json": pkg, "pnpm-workspace.yaml": "packages:\r  - apps/*\r" }],
    ["a pnpm-workspace.yaml indented as a whole that lists packages", true, { "package.json": pkg, "pnpm-workspace.yaml": "  packages:\n    - apps/*\n" }],
    // #863: pnpm also keeps project settings in the same file.
    ["a pnpm-workspace.yaml that holds only settings", false, { "package.json": pkg, "pnpm-workspace.yaml": "minimumReleaseAgeExclude:\n  - askdb\n  - '@askdb/*'\nallowBuilds:\n  better-sqlite3: true\n" }],
    ["a pnpm-workspace.yaml with an empty packages list", false, { "package.json": pkg, "pnpm-workspace.yaml": "packages: []\nallowBuilds:\n  esbuild: true\n" }],
    ["a pnpm-workspace.yaml whose packages key has no entries", false, { "package.json": pkg, "pnpm-workspace.yaml": "packages:\n# none yet\nallowBuilds:\n  esbuild: true\n" }],
    ["a pnpm-workspace.yaml whose packages list is commented out", false, { "package.json": pkg, "pnpm-workspace.yaml": "# packages:\n#   - apps/*\nminimumReleaseAge: 720\n" }],
    ["a pnpm-workspace.yaml with a packages key nested under a setting", false, { "package.json": pkg, "pnpm-workspace.yaml": "catalog:\n  packages: ^1.0.0\n" }],
    // A line or packages value it can't read counts as a list, so setup tools leave the project alone.
    ["a pnpm-workspace.yaml whose packages value is an alias", true, { "package.json": pkg, "pnpm-workspace.yaml": "x: &dirs [apps/*]\npackages: *dirs\n" }],
    ["a pnpm-workspace.yaml with an explicit packages key", true, { "package.json": pkg, "pnpm-workspace.yaml": "? packages\n: [apps/*]\n" }],
    ["a pnpm-workspace.yaml written as a flow mapping", true, { "package.json": pkg, "pnpm-workspace.yaml": "{ minimumReleaseAge: 720,\npackages:\n[apps/*] }\n" }],
    ["an npm workspaces field", true, { "package.json": '{"workspaces":["packages/*"]}\n' }],
    ["a leaf package.json", false, { "package.json": '{"name":"app","private":true}\n' }],
  ])("with %s is %s", (_label, expected, files) => {
    expect(isLikelyWorkspaceRoot(project(files))).toBe(expected);
  });
});

describe("detectPackageManager", () => {
  const pnpmDlx = { npm_config_user_agent: "pnpm/11.28.10 npm/? node/v22.23.4 darwin arm64" };
  const npx = { npm_config_user_agent: "npm/10.9.9 node/v22.23.4 darwin arm64 workspaces/false" };

  it("finds a lockfile in a parent directory", () => {
    const root = project({
      "package.json": "{}\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "packages/app/package.json": "{}\n",
    });
    expect(detectPackageManager(join(root, "packages", "app"), {})).toBe("pnpm");
  });

  // #750: `pnpm init` writes devEngines.packageManager and no lockfile, and npm refuses
  // to install there (EBADDEVENGINES).
  it("detects pnpm in a fresh `pnpm init` project with no lockfile", () => {
    const root = project({
      "package.json": JSON.stringify({
        name: "proj",
        devEngines: { packageManager: { name: "pnpm", version: "12.18.0", onFail: "download" } },
      }),
    });
    expect(detectPackageManager(root, {})).toBe("pnpm");
  });

  it.each([
    ["the packageManager field", { packageManager: "yarn@4.5.0+sha512.abc" }, {}, "yarn"],
    ["a devEngines.packageManager list", { devEngines: { packageManager: [{ name: "bun" }, { name: "npm" }] } }, {}, "bun"],
    ["the user agent of `pnpm dlx`", {}, pnpmDlx, "pnpm"],
    ["the user agent of `bunx`", {}, { npm_config_user_agent: "bun/1.2.0 npm/? node/v22.23.4 darwin arm64" }, "bun"],
    // `npx askdb init` in a project that declares pnpm still installs with pnpm.
    ["a packageManager field over the user agent", { packageManager: "pnpm@11.28.10" }, npx, "pnpm"],
    ["neither", {}, {}, "npm"],
  ])("with no lockfile, reads %s", (_label, manifest, env, expected) => {
    const root = project({ "package.json": JSON.stringify({ name: "proj", ...manifest }) });
    expect(detectPackageManager(root, env)).toBe(expected);
  });

  it("prefers an existing lockfile to the package.json fields and the user agent", () => {
    const root = project({
      "package.json": JSON.stringify({ name: "proj", packageManager: "pnpm@11.28.10" }),
      "package-lock.json": "{}\n",
    });
    expect(detectPackageManager(root, pnpmDlx)).toBe("npm");
  });

  it.each(["null", "{ not json"])("ignores a package.json holding %s", (contents) => {
    expect(detectPackageManager(project({ "package.json": contents }), {})).toBe("npm");
  });

  it("reads the field from a parent package.json when the nearest one has none", () => {
    const root = project({
      "package.json": JSON.stringify({ name: "repo", packageManager: "pnpm@11.28.10" }),
      "packages/app/package.json": JSON.stringify({ name: "app" }),
    });
    expect(detectPackageManager(join(root, "packages", "app"), {})).toBe("pnpm");
  });
});

describe("packageManagerSpawnSpec", () => {
  it("spawns the bare command without a shell on POSIX", () => {
    expect(packageManagerSpawnSpec("pnpm", ["add", "pg"], "linux")).toEqual({
      command: "pnpm",
      args: ["add", "pg"],
      shell: false,
    });
  });

  it("uses a shell on Windows so .cmd shims can run", () => {
    expect(packageManagerSpawnSpec("npm", ["install", "--save", "@askdb/config@1.0.0-beta.3"], "win32")).toEqual({
      command: "npm",
      args: ["install", "--save", "@askdb/config@1.0.0-beta.3"],
      shell: true,
    });
  });

  // Setup approves @prisma/engines on pnpm 11 when it installs @askdb/prisma (#259).
  it("passes a pnpm build approval for a package name", () => {
    expect(packageManagerSpawnSpec("pnpm", ["add", "--allow-build=@prisma/engines", "@askdb/prisma@0.2.0"], "win32").args).toEqual([
      "add",
      "--allow-build=@prisma/engines",
      "@askdb/prisma@0.2.0",
    ]);
  });

  it("refuses arguments a shell could interpret", () => {
    for (const bad of ["pg && calc", "pg;rm", "$(x)", "pg|x", "a b", "`x`", "--allow-build=x&calc", "--allow-build=$(x)", "--x=y"]) {
      expect(() => packageManagerSpawnSpec("pnpm", ["add", bad], "win32")).toThrow(/unsafe argument/);
    }
  });
});
