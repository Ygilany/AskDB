# Phase 4 — Publish to npm + BYO executor seam (requirements)

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

AskDB's mission positions it as a **developer-first embed**: an installable package teams plug into their own apps, with **BYO API keys**, **BYO database connectivity**, and (next) BYO embedder + vector store ([`docs/mission.md`](../../mission.md)). Today, every workspace package — `@askdb/core`, `askdb`, `@askdb/http-api` — is `"private": true` and tightly coupled to the in-repo `pg` dependency.

Phase 4 closes that gap: **ship to npm**, and decouple `@askdb/core` from a hardcoded database driver so consumers using `postgres.js`, Neon HTTP, Cloudflare Hyperdrive, MCP-mediated DBs, or a serverless pool can plug their own executor in without forking.

## Problem

Without publishable packages and a pluggable executor, AskDB is effectively a private-repo internal tool:

- **No `pnpm add @askdb/core`** — integrators can't try the library without cloning.
- **`pg` is mandatory** — `@askdb/core/exec/postgres.ts` is the only execution path; teams using a different driver have to fork or shell out to the CLI.
- **No semver discipline** — there's no public surface or release tooling to break against.
- **Phase 5/6/7/8 (Schema v2 in core, introspection, TUI, RAG) require this floor** — none of them can be standalone consumers of `@askdb/core` if `@askdb/core` itself isn't installable.

## Scope (in)

### 1) Publish-readiness for `@askdb/core`, `askdb`, `@askdb/http-api`

- Drop `"private": true`. Set initial published version (e.g. `0.1.0` — pre-1.0 contract).
- Add per-package `LICENSE` (Apache-2.0; include **`NOTICE`** at repo root if bundling third-party notices per Apache practice), `README.md`, and accurate `keywords` / `repository` / `homepage` fields in `package.json`.
- Tighten `exports` and `files`. `@askdb/core` already exports a clean barrel (`packages/core/src/index.ts`); confirm types resolve under both `bundler` and `node16` `moduleResolution` for downstream consumers.
- Mark Node engine constraint aligned with the monorepo root (`engines.node: ">=20"` today); document supported runtimes ([`docs/platform.md`](../../platform.md) targets current Node LTS for production integrators).
- Confirm CJS interop story (ESM-only is acceptable; document it).

### 2) Executor seam in `@askdb/core`

A small, public interface that lets consumers run the generated SQL with their own driver:

```ts
type AskDbExecutor = (sql: string, params?: unknown[]) => Promise<TabularResult>;
```

Wired into `ask()`:

```ts
ask({
  question, schema, model,
  // either of these — never both
  connectionString,           // existing path; uses built-in pg executor
  executor,                   // new path; consumer-supplied
  execute: true,
});
```

- The **built-in `pg` executor** stays the default and the reference implementation. Its `BEGIN READ ONLY` transaction semantics from Phase 1 are preserved.
- **`pg` becomes a `peerDependency` (optional)** — listed in `peerDependenciesMeta` as optional. Consumers who only use `executor` never install `pg`.
- The executor seam is part of the published `@askdb/core` API and follows semver from this phase forward.

### 3) Release tooling and CI

- Adopt **changesets** (or equivalent) to manage versions and changelogs across the workspace.
- Add CI publish workflow (manual approval to start; automated on tagged release later).
- Validate the published artifact via `pnpm pack` smoke + a downstream consumer test (see [`validation.md`](./validation.md)).

### 4) Documentation

- Top-level `README.md` updated with `pnpm add @askdb/core` snippets and a minimal executor-seam example.
- New `docs/integration/installable-package.md` (or extend `reuse-core-phase-3.md`) with BYO executor + BYO model recipes (OpenAI, AI Gateway, Bedrock, Anthropic).
- Each published package gets a focused `README.md`.

## Out of scope

- Schema v2 (lands in Phase 5 as a pre-1.0 breaking change with no migrator — this phase ships the existing format).
- Introspection, TUI, RAG, web UI (Phases 6–9).
- Non-Postgres dialect support in NL→SQL generation (still Phase 11).
- A `@askdb/sdk` higher-level facade — the published `@askdb/core` is the SDK for now.
- 1.0 stability — pre-1.0 versions allow contract evolution.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| First published version | **`0.1.0`** for `@askdb/core` (pre-1.0; semver applies to current `index.ts` exports + contract docs). |
| First npm release scope | **`@askdb/core`**, **`askdb`**, and **`@askdb/http-api`** published together at **`0.1.0`** (lockstep). |
| License | **Apache License 2.0** (SPDX: `Apache-2.0`) — permissive, with explicit patent grant; `LICENSE` + **`NOTICE`** at repo root; mirror or reference in each published package as required for npm. |
| Merge vs npm | **Implementation PR merges** when CI, pack/smoke, and changesets gates pass. **First public `npm publish`** may be a **separate maintainer step** after merge (not a merge blocker). |
| Postgres helper packaging | **Subpath `@askdb/core/postgres`** for `createPostgresExecutor` (and any `pg`-touching code). Main `@askdb/core` entry stays free of `pg` load for consumers who only import `ask` + custom `executor`. See [Postgres helper packaging](#postgres-helper-packaging-tradeoffs). |
| Module format | **ESM-only** (matches current `"type": "module"`); CJS interop deferred until a consumer needs it. |
| Node engines | **`>=20`** for published packages (match root `package.json`); document in each published `package.json`. |
| Executor seam shape | Single function type `AskDbExecutor` that returns `TabularResult`. Mirrors the existing `executeReadOnlySelect` return shape so the built-in path becomes a default executor. |
| `pg` dependency | Becomes an **optional `peerDependency`**. Built-in executor lazy-imports `pg`; if not installed and the consumer only uses `executor`, no error. |
| Release tooling | **changesets** at repo root; manual publish initially, automated tagged release later. |
| HTTP API | Already exists (`@askdb/http-api`); included in Phase 4 publish to keep CLI/HTTP/core in lockstep. |
| Schema format | **Existing pre-v2 format unchanged** for this phase. Phase 5 makes the **breaking change** to Schema v2 with no migrator (acceptable pre-1.0). |

## Executor seam — contract

**Type (in `@askdb/core` exports):**

```ts
export type AskDbExecutor = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<TabularResult>;
```

**Invariants the executor must uphold:**

1. **Read-only execution** — the consumer is responsible for ensuring the executor cannot perform writes. The built-in Postgres executor does this with `BEGIN READ ONLY`. Custom executors should document their guarantee.
2. **`TabularResult` shape** — `{ columns: string[]; rows: Record<string, unknown>[] }` (matches today's `executeReadOnlySelect`). This stays stable as part of the published contract.
3. **Errors propagate** — executor errors must throw or reject; the pipeline logs `askdb.pipeline.failed` with `phase: "execute"` and rethrows. No silent swallowing.
4. **Mode boundaries unchanged** — the executor does **not** see modes; modes affect what happens *around* execution, not how SQL is run.

**Resolution rule when both inputs are passed:**

- `executor` wins; `connectionString` is ignored. The pipeline logs a warning event (`askdb.config.executor_overrides_connection_string`).
- Passing neither + `execute: true` is an error (existing behavior).

**Built-in default:**

- `import { createPostgresExecutor } from "@askdb/core/postgres";` returns an `AskDbExecutor` configured with a connection string. The default `ask()` path (no `executor`) lazy-instantiates it from `connectionString` (internal lazy `pg` load via the same factory as the subpath).

## Postgres helper packaging (tradeoffs)

**Option A — Subpath (`@askdb/core/postgres` via `package.json` `exports` + separate chunk)**

| Pros | Cons |
|------|------|
| Importers of `@askdb/core` only never load `pg`; matches “executor-only, no `pg` installed” story. | Two import paths to document (`@askdb/core` vs `@askdb/core/postgres`). |
| Bundlers analyze entry points per subpath; fewer accidental `pg` resolutions. | Slightly more `exports`/`build` wiring (second entry in `tsc` or bundler config). |
| Clear signal: “you opted into the Node `pg` stack.” | Consumers using `connectionString` must still transitively need `pg` — docs must say to install `pg` or import the postgres subpath. |

**Option B — Top-level named export (e.g. `createPostgresExecutor` from `@askdb/core`)**

| Pros | Cons |
|------|------|
| Single package import path; simpler mental model. | Some tools may still resolve `pg` when *any* export from the package is used, depending on bundler and how the package is built; risk of surprise `pg` in client bundles if misconfigured. |
| Less `exports` surface area. | Harder to guarantee the main barrel never statically references `pg`. |

**Decision for Phase 4:** **Option A (subpath)** — prioritizes executor-only consumers and keeps the optional-`pg` story auditable.

## Open choices (to resolve during implementation)

- Exact `peerDependenciesMeta` shape and how the lazy import surfaces helpful errors when a consumer forgets to install `pg` *and* doesn't supply an executor.
- **CLI npm package name:** the batteries-included CLI is published as the **unscoped** package **`askdb`** (`npm i askdb`, `npx askdb …`). The executable name is also `askdb`.

## Success (product)

After Phase 4:

1. A developer runs `pnpm add @askdb/core` in any project, imports `ask`, and gets validated SQL from an AskDB schema file + their own `LanguageModel` — no AskDB repo clone required.
2. A developer using a non-`pg` driver (e.g. `postgres.js` or Neon HTTP) implements an `AskDbExecutor` and gets the same end-to-end loop without `pg` installed.
3. The CLI (`askdb`) and HTTP API (`@askdb/http-api`) are installable from npm with the same modes / correlation / sensitive-field semantics as today.
4. A changeset-driven release flow produces tagged versions and changelogs; downstream consumers can pin versions.

## Alignment with mission and platform

- **Mission** ([`docs/mission.md`](../../mission.md)) — Phase 4 delivers the **installable contract** and **pluggable database seam** so integrators embed `@askdb/core` without cloning; secrets and connectivity remain BYO.
- **Platform** ([`docs/platform.md`](../../platform.md)) — **pnpm** workspaces, **semver** on `packages/*/src/index.ts` exports plus `docs/contracts/`, **Postgres-first** with executor seam for non-`pg` drivers, companion packages thin wrappers over core.

## References

- [`docs/mission.md`](../../mission.md) — installable SDK, BYO everything that touches secrets
- [`docs/platform.md`](../../platform.md) — published packages, executor seam, release/versioning
- [`docs/roadmap.md`](../../roadmap.md) — Phase 4
- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — execution invariants per mode
- [`docs/integration/reuse-core-phase-3.md`](../../integration/reuse-core-phase-3.md) — stable surfaces for wrappers
