/**
 * Package-manager helpers shared by the setup wizard (`setup.ts`) and the
 * execute-driver install endpoint (`server.ts`).
 *
 * Only allowlisted package names ever reach these helpers — never
 * browser-supplied strings — but {@link packageManagerSpawnSpec} re-checks
 * every argument anyway because Windows needs `shell: true` (see below).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/** The package manager implied by a lockfile directly inside `dir`, if any. */
export function lockfilePackageManager(dir: string): PackageManager | null {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return null;
}

/**
 * Arguments that add `packages` as dependencies with the given package manager.
 * `allowBuilds` are dependencies whose install scripts pnpm must be told to run
 * (`--allow-build=<name>`; pnpm 11 exits 1 on an unapproved one). npm and Yarn
 * run install scripts, and Bun skips untrusted ones without failing, so only
 * pnpm gets them.
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
 * read keeps them. `askdb init` applies the same rule (`apps/cli/src/init.ts`).
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

/** Human-readable install command, e.g. `pnpm add pg`. */
export function formatInstallCommand(
  pm: PackageManager,
  packages: readonly string[],
  allowBuilds: readonly string[] = [],
): string {
  return [pm, ...packageManagerAddArgs(pm, packages, allowBuilds)].join(" ");
}

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
