// What the release scripts must agree on: which workspace packages are public, and whether
// a version is on npm. `release-unpublished.mjs` (what `release.yml` publishes) and
// `check-unpublished-versions.mjs` (what a PR may add) both import these, so a PR can't
// add a version the guard misses but the publish step ships.
import { execFileSync } from "node:child_process";

/**
 * The public packages of the pnpm workspace at `cwd`, read by pnpm itself: every manifest
 * format pnpm accepts (`package.json`, `package.yaml`, `package.json5`), symlinks followed,
 * no install needed.
 */
export function publicPackages(cwd = process.cwd()) {
  const out = execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { cwd, encoding: "utf8" });
  return JSON.parse(out)
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version }) => ({ name, version }));
}

/**
 * Whether `name@version` is on npm. Only a 404 counts as "not published". Any other
 * `npm view` failure throws, so a registry outage can't read either way.
 */
export function isPublished({ name, version }) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout}${error.stderr}`)) return false;
    throw new Error(`npm view ${name}@${version} failed:\n${error.stderr || error.message}`);
  }
}
