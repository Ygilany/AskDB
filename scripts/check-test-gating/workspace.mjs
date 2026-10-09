// The pnpm workspace reader for scripts/check-test-gating.mjs: which package directories to scan.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Glob syntax pnpm accepts (`*`, `?`, `[…]`, `{…}`, extglobs such as `@(a|b)`); only a trailing
// `/*` is expanded here.
const GLOB = /[*?[\]{}()|]/;

/**
 * Workspace package directories from pnpm-workspace.yaml's `packages:` list.
 * Supports literal paths, a trailing `/*`, and literal `!` exclusions; any other pattern throws, so
 * the check fails closed rather than skipping a package. A pattern that matches nothing (a missing
 * path, or `dir/*` under a missing `dir`) adds nothing, as it does for pnpm. Parsed here rather than asking
 * `pnpm -r ls`, so `pnpm lint` doesn't spawn pnpm for one list it can read directly.
 * @param {string} root
 */
export function workspaceDirs(root) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
  const start = yaml.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new Error("pnpm-workspace.yaml has no `packages:` list");
  const include = [];
  const exclude = new Set();
  for (const raw of yaml.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(raw)) continue; // blank or comment line, at any indent
    if (/^[A-Za-z_][\w-]*\s*:/.test(raw)) break; // next top-level key
    const m = raw.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (!m) throw new Error(`unrecognized line in the \`packages:\` list: ${JSON.stringify(raw)}`);
    const pattern = m[1].replace(/\/+$/, ""); // `packages/a/` names the same directory as `packages/a`
    if (pattern.startsWith("!")) {
      // A glob exclusion pnpm accepts but this reader can't match would scan an excluded package.
      if (GLOB.test(pattern.slice(1))) throw new Error(`unsupported workspace exclusion "${pattern}"; extend workspaceDirs()`);
      exclude.add(pattern.slice(1));
    } else include.push(pattern);
  }
  const dirs = [];
  for (const pattern of include) {
    if (pattern.endsWith("/*") && !GLOB.test(pattern.slice(0, -2))) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const e of readdirSync(join(root, parent), { withFileTypes: true })) {
        // A package may be a symbolic link to a directory, which pnpm lists too.
        if (e.isDirectory() || (e.isSymbolicLink() && linkTarget(join(root, parent, e.name)) === "dir")) dirs.push(`${parent}/${e.name}`);
      }
    } else if (GLOB.test(pattern)) {
      throw new Error(`unsupported workspace pattern "${pattern}"; extend workspaceDirs()`);
    } else if (existsSync(join(root, pattern))) {
      dirs.push(pattern);
    }
  }
  return dirs.filter((d) => !exclude.has(d));
}

/** What a symbolic link points at: "dir", "file", or undefined for a dangling or looping link. */
export function linkTarget(path) {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? "dir" : stat.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}
