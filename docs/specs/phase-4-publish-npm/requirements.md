# Phase 4 — Publish to npm + BYO executor seam (requirements)

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

AskDB's mission positions it as a **developer-first embed**: an installable package teams plug into their own apps, with **BYO API keys**, **BYO database connectivity**, and (next) BYO embedder + vector store ([`docs/mission.md`](../../mission.md)). Today, every workspace package — `@askdb/core`, `@askdb/cli`, `@askdb/http-api` — is `"private": true` and tightly coupled to the in-repo `pg` dependency.

Phase 4 closes that gap: **ship to npm**, and decouple `@askdb/core` from a hardcoded database driver so consumers using `postgres.js`, Neon HTTP, Cloudflare Hyperdrive, MCP-mediated DBs, or a serverless pool can plug their own executor in without forking.

## Problem

Without publishable packages and a pluggable executor, AskDB is effectively a private-repo internal tool:

- **No `pnpm add @askdb/core`** — integrators can't try the library without cloning.
- **`pg` is mandatory** — `@askdb/core/exec/postgres.ts` is the only execution path; teams using a different driver have to fork or shell out to the CLI.
- **No semver discipline** — there's no public surface or release tooling to break against.
- **Phase 5/6/7/8 (Schema v2 in core, introspection, TUI, RAG) require this floor** — none of them can be standalone consumers of `@askdb/core` if `@askdb/core` itself isn't installable.

## Scope (in)

### 1) Publish-readiness for `@askdb/core`, `@askdb/cli`, `@askdb/http-api`

- Drop `"private": true`. Set initial published version (e.g. `0.1.0` — pre-1.0 contract).
- Add per-package `LICENSE` (repo-level decision; recommended MIT for the open path), `README.md`, and accurate `keywords` / `repository` / `homepage` fields in `package.json`.
- Tighten `exports` and `files`. `@askdb/core` already exports a clean barrel (`packages/core/src/index.ts`); confirm types resolve under both `bundler` and `node16` `moduleResolution` for downstream consumers.
- Mark Node engine constraint (`engines.node: ">=18"` or current minimum); document supported runtimes.
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
- Non-Postgres dialect support in NL→SQL generation (still Phase 10).
- A `@askdb/sdk` higher-level facade — the published `@askdb/core` is the SDK for now.
- 1.0 stability — pre-1.0 versions allow contract evolution.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| First published version | **`0.1.0`** for `@askdb/core` (pre-1.0; semver applies to current `index.ts` exports + contract docs). Companion packages versioned in lockstep. |
| License | **MIT** unless user overrides (record final choice in this section before merge). |
| Module format | **ESM-only** (matches current `"type": "module"`); CJS interop deferred until a consumer needs it. |
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

- `import { createPostgresExecutor } from "@askdb/core/postgres";` (or equivalent sub-export) returns an `AskDbExecutor` configured with a connection string. The default `ask()` path (no `executor`) lazy-instantiates it from `connectionString`.

## Open choices (to resolve during implementation)

- Whether to expose the built-in Postgres executor under a sub-export (`@askdb/core/postgres`) vs. a top-level named export. Sub-export keeps `@askdb/core` consumers from accidentally pulling in `pg` at load time.
- Exact `peerDependenciesMeta` shape and how the lazy import surfaces helpful errors when a consumer forgets to install `pg` *and* doesn't supply an executor.
- Initial license choice (MIT vs. Apache-2.0 vs. proprietary) — record in this doc before merge.
- Whether `@askdb/cli` ships under a separate scope (`@askdb/cli`) or as a flat package (`askdb`). Recommend keeping `@askdb/cli` and exposing the binary as `askdb`.

## Success (product)

After Phase 4:

1. A developer runs `pnpm add @askdb/core` in any project, imports `ask`, and gets validated SQL from an AskDB schema file + their own `LanguageModel` — no AskDB repo clone required.
2. A developer using a non-`pg` driver (e.g. `postgres.js` or Neon HTTP) implements an `AskDbExecutor` and gets the same end-to-end loop without `pg` installed.
3. The CLI (`askdb`) and HTTP API (`@askdb/http-api`) are installable from npm with the same modes / correlation / sensitive-field semantics as today.
4. A changeset-driven release flow produces tagged versions and changelogs; downstream consumers can pin versions.

## References

- [`docs/mission.md`](../../mission.md) — installable SDK, BYO everything that touches secrets
- [`docs/platform.md`](../../platform.md) — published packages, executor seam, release/versioning
- [`docs/roadmap.md`](../../roadmap.md) — Phase 4
- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — execution invariants per mode
- [`docs/integration/reuse-core-phase-3.md`](../../integration/reuse-core-phase-3.md) — stable surfaces for wrappers
