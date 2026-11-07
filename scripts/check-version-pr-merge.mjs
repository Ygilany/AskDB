#!/usr/bin/env node
// Passes only when <sha> is the merge commit of a merged Version PR: this repository's
// `changeset-release/main` branch, merged into `main`. `release.yml`'s `approved` job runs
// it before `publish`, so only an approved Version PR's merge publishes (ADR 0040).
//
// `publish` ships every public version npm doesn't have, built from the commit CI tested.
// `changesets.yml` keeps every other PR from adding such a version. But when a Version
// PR's merge commit gets no release run (its CI failed, or a later PR merged before CI
// finished), the next green commit on `main` would publish the approved versions with its
// own code. This refuses that commit; docs/release.md ("Publishing by Hand") says how to
// publish those versions from the Version PR's merge commit instead.
//
// Usage: GITHUB_REPOSITORY=<owner>/<repo> node scripts/check-version-pr-merge.mjs <sha>
// It reads the PRs GitHub associates with <sha> through `gh api`, so the token needs
// `pull-requests: read`.
//
// Self-test: `node --test scripts/check-version-pr-merge.test.mjs` (CI's `preflight` job).
import { execFileSync } from "node:child_process";

const VERSION_BRANCH = "changeset-release/main";
const sha = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !/^[^/\s]+\/[^/\s]+$/.test(repo ?? "")) {
  process.stderr.write("usage: GITHUB_REPOSITORY=<owner>/<repo> check-version-pr-merge.mjs <40-hex sha>\n");
  process.exit(2);
}

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
if (versionPr) {
  process.stdout.write(`${sha} is the merge commit of Version PR #${versionPr.number}.\n`);
  process.exit(0);
}

const listed = pulls.map((pr) => `#${pr.number} (${pr.head?.ref})`).join(", ") || "none";
process.stderr.write(
  `::error::${sha} isn't the merge commit of a merged Version PR (${VERSION_BRANCH}); GitHub lists these PRs for it: ${listed}. Nothing was published. Publish the unpublished versions on main by hand from the Version PR's merge commit (docs/release.md, "Publishing by Hand").\n`,
);
process.exit(1);
