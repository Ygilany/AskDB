/**
 * Package-manager helpers for the tools that set up a project: `askdb init` and
 * Studio's setup wizard and execute-driver install. One copy, so the two front
 * ends detect, format and spawn the same way.
 *
 * @experimental Tooling for `askdb init` and AskDB Studio, outside the 1.0 stability
 * promise: these exports may change in any release.
 *
 * Only allowlisted package names ever reach these helpers, never user- or
 * browser-supplied strings, but {@link packageManagerSpawnSpec} re-checks every
 * argument anyway because Windows needs `shell: true` (see below).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** @experimental See the module note. */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** How far up the helpers walk looking for a `package.json` or lockfile. */
const MAX_WALK_UP = 40;

/**
 * The nearest directory at or above `startDir` that holds a `package.json`.
 *
 * @experimental See the module note.
 */
export function findNearestPackageJsonDir(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_WALK_UP; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Whether `packageDir` looks like a monorepo or workspace root (a `pnpm-workspace.yaml`,
 * or a `workspaces` field), whose `package.json` setup tools leave alone.
 *
 * @experimental See the module note.
 */
export function isLikelyWorkspaceRoot(packageDir: string): boolean {
  if (existsSync(join(packageDir, "pnpm-workspace.yaml")) || existsSync(join(packageDir, "pnpm-workspace.yml"))) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { workspaces?: unknown };
    return pkg.workspaces !== undefined && pkg.workspaces !== null;
  } catch {
    return false;
  }
}

/**
 * The package manager implied by a lockfile directly inside `dir`, if any.
 *
 * @experimental See the module note.
 */
export function lockfilePackageManager(dir: string): PackageManager | null {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return null;
}

/**
 * The package manager to install with in `packageDir`, from the first of these that
 * names one:
 *
 * 1. a lockfile in `packageDir` or a parent (pnpm, then Bun, Yarn, npm in one directory);
 * 2. the nearest `package.json`, walking up, that declares a manager: its `packageManager`
 *    field (Corepack's `pnpm@11.28.10`), then `devEngines.packageManager` (`{ name }` or a
 *    list of them; `pnpm init` writes it);
 * 3. `npm_config_user_agent` in `env`, which `pnpm dlx`, `yarn dlx`, `npx` and `bunx` set;
 * 4. npm.
 *
 * An existing lockfile wins, so a project's install never switches managers.
 *
 * @experimental See the module note.
 */
export function detectPackageManager(
  packageDir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PackageManager {
  const dirs = ancestors(packageDir);
  for (const dir of dirs) {
    const pm = lockfilePackageManager(dir);
    if (pm) return pm;
  }
  for (const dir of dirs) {
    const pm = declaredPackageManager(dir);
    if (pm) return pm;
  }
  return knownPackageManager(env.npm_config_user_agent?.split("/")[0]) ?? "npm";
}

/** `dir` and its parents, nearest first, at most {@link MAX_WALK_UP} of them. */
function ancestors(dir: string): string[] {
  const dirs = [resolve(dir)];
  while (dirs.length < MAX_WALK_UP) {
    const parent = dirname(dirs[dirs.length - 1]!);
    if (parent === dirs[dirs.length - 1]) break;
    dirs.push(parent);
  }
  return dirs;
}

/** The manager `dir/package.json` declares in `packageManager` or `devEngines.packageManager`. */
function declaredPackageManager(dir: string): PackageManager | null {
  let pkg: { packageManager?: unknown; devEngines?: { packageManager?: unknown } };
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as typeof pkg;
  } catch {
    return null;
  }
  if (typeof pkg.packageManager === "string") {
    const pm = knownPackageManager(pkg.packageManager.split("@")[0]);
    if (pm) return pm;
  }
  const devEngine = pkg.devEngines?.packageManager;
  for (const entry of Array.isArray(devEngine) ? devEngine : [devEngine]) {
    const name = entry !== null && typeof entry === "object" ? (entry as { name?: unknown }).name : undefined;
    const pm = knownPackageManager(name);
    if (pm) return pm;
  }
  return null;
}

function knownPackageManager(name: unknown): PackageManager | null {
  return name === "pnpm" || name === "npm" || name === "yarn" || name === "bun" ? name : null;
}

/**
 * Arguments that add `packages` as dependencies with the given package manager.
 * `allowBuilds` are dependencies whose install scripts pnpm must be told to run
 * (`--allow-build=<name>`; pnpm 11 exits 1 on an unapproved one). npm and Yarn
 * run install scripts, and Bun skips untrusted ones without failing, so only
 * pnpm gets them.
 *
 * @experimental See the module note.
 */
export function packageManagerAddArgs(
  pm: PackageManager,
  packages: readonly string[],
  allowBuilds: readonly string[] = [],
): string[] {
  if (pm === "npm") return ["install", "--save", ...packages];
  if (pm === "pnpm") return ["add", ...allowBuilds.map((name) => `--allow-build=${name}`), ...packages];
  return ["add", ...packages];
}

/**
 * The build approvals to pass `pm` in `dir`: `allowBuilds`, or none for a pnpm older
 * than 10.4.0, whose `add` rejects `--allow-build` (pnpm 9 runs install scripts, and
 * 10.0 to 10.3 skip unapproved ones without failing). A pnpm whose version can't be
 * read keeps them.
 *
 * @experimental See the module note.
 */
export function supportedBuildApprovals(pm: PackageManager, dir: string, allowBuilds: readonly string[]): string[] {
  if (pm !== "pnpm" || allowBuilds.length === 0) return [...allowBuilds];
  const match = /^(\d+)\.(\d+)\./.exec(pnpmVersion(dir) ?? "");
  if (!match) return [...allowBuilds];
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 10 || (major === 10 && minor >= 4) ? [...allowBuilds] : [];
}

function pnpmVersion(dir: string): string | null {
  const { command, args, shell } = packageManagerSpawnSpec("pnpm", ["--version"]);
  const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", shell, stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Human-readable install command, e.g. `pnpm add pg`.
 *
 * @experimental See the module note.
 */
export function formatInstallCommand(
  pm: PackageManager,
  packages: readonly string[],
  allowBuilds: readonly string[] = [],
): string {
  return [pm, ...packageManagerAddArgs(pm, packages, allowBuilds)].join(" ");
}

/** @experimental See the module note. */
export type PackageManagerSpawnSpec = {
  command: string;
  args: string[];
  shell: boolean;
};

// npm package names (optionally scoped, optionally with a version/range suffix),
// simple `--flag` arguments, and pnpm's `--allow-build=<package name>`. Nothing a
// shell would interpret.
const SAFE_ARG =
  /^(?:--[a-z][a-z-]*|--allow-build=(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*|(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9.^~<>=*_-]+)?|add|install)$/i;

/**
 * How to spawn a package manager on this platform.
 *
 * On Windows, package managers are `.cmd` shims, and Node refuses to spawn
 * `.cmd`/`.bat` files without a shell (EINVAL since Node 18.20.2 / 20.12.2,
 * CVE-2024-27980). So Windows gets `shell: true` with the bare command name.
 * Arguments are validated against a strict allowlist pattern first, so the
 * shell never sees anything it could interpret.
 *
 * @experimental See the module note.
 */
export function packageManagerSpawnSpec(
  pm: PackageManager,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): PackageManagerSpawnSpec {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) {
      throw new Error(`Refusing to pass unsafe argument to ${pm}: ${JSON.stringify(arg)}`);
    }
  }
  if (platform === "win32") {
    return { command: pm, args: [...args], shell: true };
  }
  return { command: pm, args: [...args], shell: false };
}
