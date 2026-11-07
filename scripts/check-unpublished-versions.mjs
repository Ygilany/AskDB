#!/usr/bin/env node
// Fails a PR that adds a public `name@version` npm doesn't have: a version bump, a new
// public package, or a package made public. Approving the Version PR is the release
// approval (ADR 0040), so only the Version PR may add one. Merged any other way, such a
// version would hold up the next release: `release.yml`'s `approved` job refuses to
// publish a version the Version PR didn't add. `changesets.yml` runs this on every PR
// except the Version PR.
//
// Usage: node scripts/check-unpublished-versions.mjs --since <ref>
//
// It compares the public packages at HEAD with those at the merge base of <ref> and HEAD,
// read from that commit's tree, both through `publicPackages()`: the list
// `release-unpublished.mjs` publishes from. So it sees every manifest format pnpm reads
// and follows symlinks as pnpm does. Each `name@version` that is new since the merge base
// is looked up on npm. One already there passes, like a new package's first version,
// published by hand. A version that came in with the base isn't this PR's to answer for.
//
// Self-test: `node --test scripts/check-unpublished-versions.test.mjs` (CI's `preflight` job).
import { execFileSync } from "node:child_process";
import { isPublished, nameAtVersion, publicPackages, publicPackagesAt } from "./release-packages.mjs";

const at = process.argv.indexOf("--since");
const since = at === -1 ? undefined : process.argv[at + 1];
if (!since) {
  process.stderr.write("usage: check-unpublished-versions.mjs --since <ref>\n");
  process.exit(2);
}

const base = execFileSync("git", ["merge-base", since, "HEAD"], { encoding: "utf8" }).trim();
const atBase = new Set(publicPackagesAt(base).map(nameAtVersion));
const added = publicPackages().filter((pkg) => !atBase.has(nameAtVersion(pkg)));

let unpublished = 0;
for (const pkg of added) {
  let published;
  try {
    published = isPublished(pkg);
  } catch (error) {
    process.stderr.write(`::error::${error.message.split("\n")[0]}\n${error.message}\n`);
    process.exit(1);
  }
  if (published) {
    process.stdout.write(`${nameAtVersion(pkg)}: new since the merge base, already on npm\n`);
    continue;
  }
  unpublished += 1;
  process.stderr.write(
    `::error::${nameAtVersion(pkg)} isn't on npm, and only the Version PR may add an unpublished version. Revert the version and add a changeset (pnpm changeset). A new public package needs its first version published by hand (docs/release.md).\n`,
  );
}
if (unpublished === 0) process.stdout.write(`No unpublished public version is new since ${base.slice(0, 8)}.\n`);
process.exit(unpublished === 0 ? 0 : 1);
