# Validation — Phase 4 (publish + executor seam) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

**Merge bar (implementation PR):** CI green, **executor seam** contract tests, **`pnpm pack`** + metadata checks, **consumer install smoke** from local tarballs, and **changesets** gate. **First public `npm publish` is not required to merge** — it may follow as a **separate maintainer step** once credentials and registry access are ready.

**Post-merge / release:** Maintainers publish `@askdb/core`, `askdb`, and `@askdb/http-api` to the public registry when appropriate; optional smoke against `pnpm view` and a clean `pnpm add` outside the repo validates the published artifact.

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
   - For each of `@askdb/core`, `askdb`, `@askdb/http-api`:
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

## Manual (short) — optional until first public publish

- **After first publish:** from a maintainer machine, `pnpm view @askdb/core` returns the expected version; spot-check tarballs on npm for accidental files (secrets, source maps pointing at private paths).
- Check a short reusable smoke script into the repo (e.g. `examples/installable-smoke/index.ts` plus a tiny `package.json`) that imports `ask` from `@askdb/core` and calls it against a mock `LanguageModel` + fake executor. The same script powers the **Consumer install smoke** automated job above — keep them in lockstep.
- **Validates the registry artifact (post-publish):** in a fresh directory outside the repo, `pnpm init && pnpm add @askdb/core@<published-version>`, run the same smoke; confirms consumers work without cloning the repo.

## Non-blockers for Phase 4 merge

- **Packages appearing on the public npm registry** — merge is satisfied by local tarballs + dry-run; publish is a follow-on maintainer action ([`requirements.md`](./requirements.md) “Merge vs npm”).
- Schema v2 (Phase 5).
- `@askdb/introspect`, `@askdb/tui`, and `@askdb/rag` packages (Phases 6–8).
- Web app, embed SDK, multi-engine support, MCP surface.
- 1.0 release — pre-1.0 is acceptable and expected.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — execution invariants
- [`docs/platform.md`](../../platform.md) — release/versioning conventions
