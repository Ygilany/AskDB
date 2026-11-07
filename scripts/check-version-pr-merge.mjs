#!/usr/bin/env node
// Passes only when <sha> is the merge commit of a merged Version PR (this repository's
// `changeset-release/main` branch, merged into `main`) and that merge added every version
// about to be published. `release.yml`'s `approved` job runs it before `publish`, so only
// what an approved Version PR added publishes (ADR 0040).
//
// `publish` ships every public version npm doesn't have, built from the commit CI tested.
// `changesets.yml` keeps every other PR from adding such a version. Two ways round that
// remain, and this refuses both:
// - The commit isn't a Version PR's merge: a Version PR's merge got no release run (its CI
//   failed, or a later PR merged before CI finished), and a later commit would publish the
//   approved versions with its own code.
// - The commit is a Version PR's merge, but some of those versions were already unpublished
//   on `main` before it (in its first parent): an earlier Version PR whose publish never
//   ran, or a version an admin merge added. This Version PR's approval didn't cover them.
// docs/release.md ("Publishing by Hand") says how to publish refused versions instead.
//
// Usage: GITHUB_REPOSITORY=<owner>/<repo> PACKAGES='[{"name":…,"version":…}]' \
//          node scripts/check-version-pr-merge.mjs <sha>
// PACKAGES is the list `release-unpublished.mjs` printed for <sha>. The PRs come from
// `gh api` (the token needs `pull-requests: read`); the first parent's packages come from
// its git tree, read by pnpm, so the checkout needs that commit.
//
// Self-test: `node --test scripts/check-version-pr-merge.test.mjs` (CI's `preflight` job).
import { execFileSync } from "node:child_process";
import { nameAtVersion, publicPackagesAt } from "./release-packages.mjs";

const VERSION_BRANCH = "changeset-release/main";
const sha = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
let packages;
try {
  packages = JSON.parse(process.env.PACKAGES ?? "");
} catch {
  packages = undefined;
}
if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !/^[^/\s]+\/[^/\s]+$/.test(repo ?? "") || !Array.isArray(packages)) {
  process.stderr.write(
    "usage: GITHUB_REPOSITORY=<owner>/<repo> PACKAGES=<JSON array of { name, version }> check-version-pr-merge.mjs <40-hex sha>\n",
  );
  process.exit(2);
}

const HAND_PUBLISH = `docs/release.md, "Publishing by Hand"`;

let pulls;
try {
  const out = execFileSync("gh", ["api", `repos/${repo}/commits/${sha}/pulls?per_page=100`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  pulls = JSON.parse(out);
} catch (error) {
  process.stderr.write(`::error::Could not read the PRs for ${sha}: ${(error.stderr || error.message).trim()}\n`);
  process.exit(1);
}

const versionPr = pulls.find(
  (pr) =>
    pr.merged_at &&
    pr.merge_commit_sha === sha &&
    pr.base?.ref === "main" &&
    pr.head?.ref === VERSION_BRANCH &&
    pr.head?.repo?.full_name === repo,
);
if (!versionPr) {
  const listed = pulls.map((pr) => `#${pr.number} (${pr.head?.ref})`).join(", ") || "none";
  process.stderr.write(
    `::error::${sha} isn't the merge commit of a merged Version PR (${VERSION_BRANCH}); GitHub lists these PRs for it: ${listed}. Nothing was published. Publish the unpublished versions on main by hand from the merge commit of the Version PR that added them (${HAND_PUBLISH}).\n`,
  );
  process.exit(1);
}

const parent = execFileSync("git", ["rev-parse", `${sha}^1`], { encoding: "utf8" }).trim();
const beforeMerge = new Set(publicPackagesAt(parent).map(nameAtVersion));
const leftover = packages.map(nameAtVersion).filter((id) => beforeMerge.has(id));
if (leftover.length > 0) {
  process.stderr.write(
    `::error::Version PR #${versionPr.number} didn't add ${leftover.join(", ")}: already unpublished on main before it merged (${parent.slice(0, 8)}), so its approval doesn't cover them. Nothing was published. Publish each by hand from the merge commit of the Version PR that added it, and revert one no Version PR added; then publish the rest of this merge's versions by hand from ${sha.slice(0, 8)} (${HAND_PUBLISH}).\n`,
  );
  process.exit(1);
}

process.stdout.write(`${sha} is the merge commit of Version PR #${versionPr.number}, which added every version to publish.\n`);
