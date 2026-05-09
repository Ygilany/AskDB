# Validation — Phase 4 (publish + executor seam) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, the **executor seam** is contract-tested, and a **consumer install smoke test** proves the published artifacts are usable.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity unchanged).
   - Existing Phase 1 / 2 / 2.5 / 3 tests remain green; no regression in CLI, HTTP, modes, sensitive-field, or correlation-ID behavior.

2. **Executor seam contract tests** (`packages/core/`)
   - `ask({ ..., executor, execute: true })` returns the executor's result and never instantiates the built-in `pg` executor.
   - `ask({ ..., connectionString, execute: true })` continues to use the built-in path (Pagila integration test green when `DATABASE_URL` is set).
   - Passing both `executor` and `connectionString`: executor wins; warning event `askdb.config.executor_overrides_connection_string` is emitted.
   - Passing neither with `execute: true`: throws the existing `AskDbError`.
   - Custom executor that throws: pipeline emits `askdb.pipeline.failed` with `phase: "execute"` and rethrows (no swallowing).

3. **Optional `pg` peer dependency**
   - A test (or smoke job) installs `@askdb/core` **without** `pg` and proves:
     - Importing `ask` and calling it with a custom `executor` works.
     - Calling it with `connectionString` produces a clear error mentioning the missing peer dependency.

4. **Pack and metadata checks**
   - For each of `@askdb/core`, `@askdb/cli`, `@askdb/http-api`:
     - `pnpm pack` succeeds; tarball contents include `dist/`, `package.json`, `README.md`, `LICENSE`.
     - Tarball contents **exclude** `src/`, `tsconfig*`, `node_modules/`, test files.
     - `package.json` has `"private": false`, valid `repository`, `license`, `engines`, `keywords`.

5. **Consumer install smoke**
   - A CI-only job (or the `examples/installable-smoke/` workspace shared with the manual run below):
     - Installs the three packages from local tarballs into a fresh directory.
     - Runs the checked-in TypeScript program (`examples/installable-smoke/index.ts` or equivalent) that imports `ask` and uses a mock `LanguageModel` + fake executor.
     - `tsc --noEmit` succeeds — types resolve cleanly.

6. **Changesets gate**
   - CI fails on PRs that change published-package source without a corresponding changeset.
   - `pnpm changeset publish --dry-run` (or equivalent) succeeds and reports the expected versions in CI logs.

## Manual (short)

- Run a real publish (e.g. `0.1.0-rc.1` or the chosen first version) from a maintainer's machine; `pnpm view @askdb/core` returns the version.
- Check a short reusable smoke script into the repo (e.g. `examples/installable-smoke/index.ts` plus a tiny `package.json`) that imports `ask` from `@askdb/core` and calls it against a mock `LanguageModel` + fake executor. The same script powers the **Consumer install smoke** automated job above and the manual run below — keep them in lockstep so this isn't ad-hoc maintainer-only knowledge.
- In a fresh directory outside the repo: `pnpm init && pnpm add @askdb/core@<published-version>`, copy the fixture script over (or `pnpm add` from the published tarball URL), and run it. Confirm it works without cloning the AskDB repo.
- Spot-check the published tarballs on npm for accidental files (especially secrets, source maps to private paths, etc.).

## Non-blockers for Phase 4 merge

- Schema v2 (Phase 5).
- `@askdb/introspect`, `@askdb/tui`, and `@askdb/rag` packages (Phases 6–8).
- Web app, embed SDK, multi-engine support, MCP surface.
- 1.0 release — pre-1.0 is acceptable and expected.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — execution invariants
- [`docs/platform.md`](../../platform.md) — release/versioning conventions
