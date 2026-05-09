# Plan — Phase 4 (publish + executor seam) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable** without waiting for the full phase to land. Dependencies flow downward.

## 1 — Executor seam in `@askdb/core` (no publish yet)

- Add `AskDbExecutor` type to `packages/core/src/index.ts` exports.
- Refactor `ask()` in `packages/core/src/ask.ts` to accept `executor?: AskDbExecutor`. When supplied, use it; otherwise fall back to the existing `connectionString` → `executeReadOnlySelect` path.
- Extract the built-in `pg`-backed executor into a factory (e.g. `createPostgresExecutor(connectionString) → AskDbExecutor`); keep `executeReadOnlySelect` as an internal wrapper or deprecate in favor of the factory.
- Add unit tests for both paths:
  - Custom executor returns canned `TabularResult` → `ask()` returns the same shape.
  - `connectionString` path still works against Pagila integration tests (CI-gated as today).
  - Passing both: `executor` wins, warning event emitted.
  - Passing neither + `execute: true`: existing error.

**Demo:** A test that supplies a fake executor (`(sql) => ({ columns: ["x"], rows: [{ x: 1 }] })`) and proves `ask({ ..., executor, execute: true })` returns it without `pg` ever being touched.

## 2 — Make `pg` an optional peer dependency

- Move `pg` from `dependencies` to `peerDependencies` and add `peerDependenciesMeta: { pg: { optional: true } }` in `packages/core/package.json`.
- Add **`package.json` `exports`** entry for **`@askdb/core/postgres`** pointing at the built chunk (`./dist/postgres.js` or equivalent) so `createPostgresExecutor` is not re-exported from the main barrel.
- Lazy-import `pg` inside `createPostgresExecutor`; throw a helpful error (`AskDbError("Postgres executor requires the 'pg' peer dependency...")`) only when the built-in executor is actually constructed.
- Update root + workspace `pnpm install` so the dev environment still installs `pg` (it stays a `devDependency` of the workspace, or a regular dep of `@askdb/cli` and `@askdb/http-api` which use the built-in executor).

**Demo:** A consumer mock-package that depends on `@askdb/core` only (no `pg`) imports `ask` and runs against a fake executor with no install errors.

## 3 — Drop `private`, fill in package metadata

For `@askdb/core`, `@askdb/cli`, `@askdb/http-api`:

- Remove `"private": true`; bump version to `0.1.0`.
- Add or update fields: `description`, `keywords`, `repository`, `homepage`, `bugs`, `license`, `author`, `engines`.
- Verify `files` only ships `dist/` (and `README.md`, `LICENSE`).
- Add per-package `README.md` with install + minimal usage.
- Run `pnpm pack` for each package; inspect tarball contents for stray `src/`, `tsconfig.*`, or test files.

**Demo:** `pnpm pack` produces three tarballs whose `package.json` has `"private": false` and whose contents match expectations.

## 4 — Consumer install smoke test

- Add `examples/installable-smoke/` (or a CI job) that:
  - Builds the workspace.
  - `npm install` from the local tarballs (or via `verdaccio` / `pnpm pack` consumed in a temp dir).
  - Imports `ask` from `@askdb/core` and runs against a mock `LanguageModel` + fake executor.
  - Confirms types resolve (run `tsc --noEmit` on the consumer code).

**Demo:** The smoke test fails clearly if any of: `private: true` slips back in, `dist/` is missing files, types don't resolve, or the executor seam regresses.

## 5 — Release tooling (changesets) + first publish dry-run

- Adopt **changesets** at the repo root (`pnpm dlx @changesets/cli init`).
- Configure for the workspace; commit initial changeset describing the v0.1.0 release.
- Add CI workflow: on PR → validate changesets present when publishable sources change; publishing can remain **manual** until the team wires automated `changeset publish` (first **public** npm release may be a **post-merge maintainer step** — see [`validation.md`](./validation.md)).
- Run a **dry-run publish** (`pnpm changeset publish --dry-run` or `npm publish --dry-run`) and confirm output.

**Demo:** A dry-run publish reports the expected versions for all three packages and surfaces no warnings about missing fields, `private: true`, or oversized tarballs.

## 6 — Documentation: install + BYO recipes

- Update top-level `README.md`:
  - `pnpm add @askdb/core` snippet.
  - Minimal example with OpenAI model + `connectionString`.
  - Minimal example with custom executor (no `pg`).
- Add `docs/integration/installable-package.md` with deeper recipes:
  - OpenAI, AI Gateway, Bedrock, Anthropic, Ollama (BYO model).
  - `pg`, `postgres.js`, Neon HTTP, MCP-mediated DB (BYO executor).
- Cross-link from `docs/mission.md` and `docs/platform.md` (already updated).

**Demo:** A new contributor following only the `README.md` install snippet can import `@askdb/core` and run `ask()` against a mock model + fake executor without reading the rest of the repo.

## 7 — First real publish (maintainer follow-up, not a merge prerequisite)

- After the Phase 4 implementation PR is merged (CI + pack + smoke + changesets already green), maintainers **tag and publish** `0.1.0` for all three packages when ready.
- Smoke-test in a fresh project (`mkdir /tmp/askdb-test && cd $_ && pnpm init && pnpm add @askdb/core`).
- Optionally confirm CI publish workflow for subsequent releases.

**Demo:** `pnpm view @askdb/core` returns the newly published version; a fresh `pnpm add @askdb/core` install works in a clean directory.

---

**Implementation locus:** `packages/core/`, `packages/cli/`, `packages/http-api/`, repo root (changesets, CI workflows, top-level README), `docs/integration/`. No new packages added in Phase 4.
