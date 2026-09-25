/**
 * Package-manager helpers shared by the setup wizard (`setup.ts`) and the
 * execute-driver install endpoint (`server.ts`).
 *
 * Only allowlisted package names ever reach these helpers — never
 * browser-supplied strings — but {@link packageManagerSpawnSpec} re-checks
 * every argument anyway because Windows needs `shell: true` (see below).
 */

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

/** Arguments that add `packages` as dependencies with the given package manager. */
export function packageManagerAddArgs(pm: PackageManager, packages: readonly string[]): string[] {
  return pm === "npm" ? ["install", "--save", ...packages] : ["add", ...packages];
}

/** Human-readable install command, e.g. `pnpm add pg`. */
export function formatInstallCommand(pm: PackageManager, packages: readonly string[]): string {
  return [pm, ...packageManagerAddArgs(pm, packages)].join(" ");
}

export type PackageManagerSpawnSpec = {
  command: string;
  args: string[];
  shell: boolean;
};

// npm package names (optionally scoped, optionally with a version/range suffix)
// and simple `--flag` arguments. Nothing a shell would interpret.
const SAFE_ARG = /^(?:--[a-z][a-z-]*|(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9.^~<>=*_-]+)?|add|install)$/i;

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
