/**
 * A fresh pnpm project in the system temp directory that installs packages pinned to the
 * lab's install target, the way an outside project would. Inside the lab, Node's resolution
 * would walk up to the lab's own `node_modules` (its drivers, its `@askdb/prisma`), so
 * scenarios about what an install leaves out need a project of their own.
 *
 * The project's `pnpm-workspace.yaml` holds only the lab's `@askdb/*` pins (its `lab:use`
 * overrides block), so it approves no build: pnpm 11 exits 1 when an installed package has
 * an install script nobody approved.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, join, resolve } from "node:path";
import { LAB_ROOT } from "./paths.js";

/** The lab's `@askdb/*` pins (its `lab:use` overrides block), with tarball paths made absolute. */
export function labPins(): Map<string, string> {
  const ws = readFileSync(join(LAB_ROOT, "pnpm-workspace.yaml"), "utf8");
  const pins = [...ws.matchAll(/^ {2}"([^"]+)": "([^"]+)"$/gm)].map(([, name, spec]) => {
    const path = spec!.startsWith("file:") ? spec!.slice("file:".length) : undefined;
    return [name!, path && !isAbsolute(path) ? `file:${resolve(LAB_ROOT, path)}` : spec!] as const;
  });
  if (!pins.length) throw new Error("the lab's pnpm-workspace.yaml has no lab:use overrides; run `pnpm lab:use <target>`");
  return new Map(pins);
}

/** Every package in a pnpm lockfile's `packages:` section, as `{ name, spec }`: a version, or `file:<tarball>`. */
export function lockedPackages(lockfile: string): { name: string; spec: string }[] {
  const start = lockfile.indexOf("\npackages:\n");
  if (start < 0) throw new Error("the project's pnpm-lock.yaml has no packages section");
  const end = lockfile.indexOf("\nsnapshots:\n", start);
  const section = lockfile.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^ {2}'?((?:@[\w.-]+\/)?[\w.-]+)@([^'\n]+?)'?:$/gm)].map((m) => ({ name: m[1]!, spec: m[2]! }));
}

/** Whether a locked `@askdb/*` spec is the lab target's pin: the same tarball, or the same version. */
export function fromTarget(locked: string, pin: string | undefined): boolean {
  if (!pin) return false;
  if (pin.startsWith("file:")) return locked.startsWith("file:") && basename(locked) === basename(pin);
  return locked === pin;
}

export function resolvesFrom(packageDir: string, request: string): boolean {
  try {
    createRequire(join(realpathSync(packageDir), "package.json")).resolve(request);
    return true;
  } catch {
    return false;
  }
}

/** The version or tarball a fresh project should install `name` at: the target's pin, else the lab's own pin. */
export function targetSpec(name: string, pins = labPins()): string {
  const lab = JSON.parse(readFileSync(join(LAB_ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  const spec = pins.get(name) ?? lab.dependencies[name];
  if (!spec) throw new Error(`neither the lab's install target nor its package.json pins ${name}`);
  return spec;
}

/**
 * Write `package.json` (`packages` at `targetSpec`) and `pnpm-workspace.yaml` (the pins) into
 * `dir`, then `pnpm install`. Returns the install's result; it does not throw on a non-zero exit.
 *
 * `unpinned` leaves packages out of the overrides. A project that must not install an
 * optional peer needs it: pnpm installs an optional peer whose override is a `file:`
 * tarball (any target `lab:use` packs) as if it were a dependency.
 */
export function installFreshProject(
  dir: string,
  name: string,
  packages: readonly string[],
  { unpinned = [] }: { unpinned?: readonly string[] } = {},
): SpawnSyncReturns<string> {
  const pins = labPins();
  const dependencies = Object.fromEntries(packages.map((pkg) => [pkg, targetSpec(pkg, pins)]));
  const overrides = [...pins].filter(([pkg]) => !unpinned.includes(pkg));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true, type: "module", dependencies }, null, 2));
  writeFileSync(join(dir, "pnpm-workspace.yaml"), `overrides:\n${overrides.map(([pkg, spec]) => `  "${pkg}": "${spec}"`).join("\n")}\n`);
  return spawnSync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: dir, encoding: "utf8" });
}
