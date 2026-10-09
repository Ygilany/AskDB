// The pnpm workspace reader for scripts/check-test-gating.mjs: which package directories to scan.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace package directories from pnpm-workspace.yaml's `packages:` list.
 * Supports literal paths, a trailing `/*`, and literal `!` exclusions; anything else throws, so the
 * check fails closed rather than skipping a package. Parsed here rather than asking
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
    const pattern = m[1];
    if (pattern.startsWith("!")) {
      // A glob exclusion pnpm accepts but this reader can't match would scan an excluded package.
      if (pattern.includes("*")) throw new Error(`check-test-gating: unsupported workspace exclusion "${pattern}"; extend workspaceDirs()`);
      exclude.add(pattern.slice(1));
    }
    else include.push(pattern);
  }
  const dirs = [];
  for (const pattern of include) {
    if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const e of readdirSync(join(root, parent), { withFileTypes: true })) {
        if (e.isDirectory()) dirs.push(`${parent}/${e.name}`);
      }
    } else if (pattern.includes("*")) {
      throw new Error(`check-test-gating: unsupported workspace pattern "${pattern}"; extend workspaceDirs()`);
    } else if (existsSync(join(root, pattern))) {
      dirs.push(pattern);
    }
  }
  return dirs.filter((d) => !exclude.has(d));
}
