# ADR 0020 — A change with no behavior or public-type change takes an empty changeset

## Status

Proposed (2026-10-09, #326). Stated in `AGENTS.md` ("Conventions") and `CONTRIBUTING.md` ("Before Opening a PR").

## Context

The Changesets workflow (`.github/workflows/changesets.yml`) runs on every PR, and its `status` job can be a required check in the `main` branch ruleset (a GitHub repository setting, not a file in the repo; the workflow's own comment says so). It requires a changeset whenever a PR touches a publishable package's `src/` (`packages/*/src`, `apps/{cli,http-api,studio}/src`) or a publishable package's manifest (`packages/*/package.json`, `apps/{cli,http-api,studio}/package.json`) outside `devDependencies`. Some of those changes alter nothing a package ships: a test file under `src/`, or a comment outside an exported declaration. A patch changeset for such a change publishes a new version identical in behavior and types to the last one, and adds a changelog entry that says nothing to a host.

## Options considered

### A. Patch changeset

Rejected. It satisfies the check but releases a version with no change a host can observe, and its changelog line is noise.

### B. Narrow the workflow's path filter

Exclude `*.test.ts(x)` and test fixtures from the filter so test-only changes need no entry. Rejected: a filter can't tell a comment-only edit from a code edit in the same file, so the problem stays for comments, and every exclusion is one more pattern that can hide a real change from the check.

### C. Empty changeset (chosen)

`pnpm changeset --empty` writes a changeset with no package bumps. The check passes, no version moves, and the PR still says on purpose that it changes no behavior.

## Decision

A change that alters no behavior and no public type (tests, or comments outside exported declarations, since JSDoc on an export is part of the package's `.d.ts`) takes `pnpm changeset --empty` when the check asks for an entry, not a patch bump. Docs-site edits are the exception: they take a patch changeset for `@askdb/docs-site` (`apps/docs-site/STYLE.md`).

## Consequences

- A reviewer checks that an empty changeset's PR really changes no behavior or public type: a changed export, default, error text or JSDoc on an export needs a real bump.
- The workflow's filter stays as it is; changing it supersedes this ADR.
