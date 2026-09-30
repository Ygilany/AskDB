#!/usr/bin/env node
// Lists the public workspace packages whose current version isn't on npm yet, as a
// JSON array of `{ name, version }` on stdout. `release.yml` uses it to decide whether
// there is anything to publish (so a push to `main` without a merged Version PR never
// asks for a publish approval) and which git tags to create afterwards.
//
// Only a 404 from the registry counts as "not published". Any other `npm view`
// failure exits non-zero, so a registry outage can't read as "publish everything".
import { execFileSync } from "node:child_process";

function workspacePackages() {
  const out = execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { encoding: "utf8" });
  return JSON.parse(out)
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version }) => ({ name, version }));
}

function isPublished({ name, version }) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout}${error.stderr}`)) return false;
    process.stderr.write(`release-unpublished: npm view ${name}@${version} failed:\n${error.stderr}`);
    process.exit(1);
  }
}

const unpublished = workspacePackages().filter((pkg) => !isPublished(pkg));
process.stdout.write(`${JSON.stringify(unpublished)}\n`);
