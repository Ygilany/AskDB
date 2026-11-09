// What the release scripts must agree on: which workspace packages are public, and whether
// a version is on npm. `release-unpublished.mjs` (what `release.yml` publishes),
// `check-unpublished-versions.mjs` (what a PR may add), `check-version-pr-merge.mjs` (what a
// Version PR's merge may publish) and `prerelease-counter.mjs` (which versions the Version
// PR may leave) all import these, so none of them can read the packages differently.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The public packages of the pnpm workspace at `cwd`, read by pnpm itself: every manifest
 * format pnpm accepts (`package.json`, `package.yaml`, `package.json5`), symlinks followed,
 * no install needed.
 */
export function publicPackages(cwd = process.cwd()) {
  const out = execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { cwd, encoding: "utf8" });
  return JSON.parse(out)
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version, path }) => ({ name, version, path }));
}

/** The public packages in `commit`'s tree, read the same way from a temporary copy of it. */
export function publicPackagesAt(commit) {
  const dir = mkdtempSync(join(tmpdir(), "release-packages-"));
  try {
    const tree = execFileSync("git", ["archive", "--format=tar", commit], { maxBuffer: 1 << 30 });
    execFileSync("tar", ["-x", "-C", dir], { input: tree });
    return publicPackages(dir).map(({ name, version }) => ({ name, version }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const nameAtVersion = ({ name, version }) => `${name}@${version}`;

/**
 * Whether `name@version` is on npm. Only a 404 counts as "not published". Any other
 * `npm view` failure throws, so a registry outage can't read either way.
 */
export function isPublished({ name, version }) {
  try {
    execFileSync("npm", ["view", nameAtVersion({ name, version }), "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout}${error.stderr}`)) return false;
    throw new Error(`npm view ${nameAtVersion({ name, version })} failed:\n${error.stderr || error.message}`);
  }
}
