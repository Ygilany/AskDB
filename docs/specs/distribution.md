# Feature: Distribution

**Status:** Complete  
**Packages:** `@askdb/core`, `askdb`, `@askdb/http-api`, `@askdb/introspect`, `@askdb/postgres`, `@askdb/rag`, `@askdb/tui`, `@askdb/enrich`

## Overview

AskDB packages are published to npm under the `@askdb` scope. The distribution model is developer-first: consumers run `pnpm add @askdb/core`, supply their own model and dialect adapter, and call `ask()` from their own runtime. No database connection or API key is bundled.

Release tooling uses changesets for versioning and changelog generation. Packages use semantic versioning; pre-1.0 versions allow breaking changes with a clear changeset entry rather than a migrator.

## Scope

### In scope

- All `@askdb/*` packages and `askdb` CLI published to npm
- `package.json` metadata: `description`, `keywords`, `repository`, `homepage`, `license`, `engines`, `files` (dist only)
- `pnpm pack` validation — tarballs exclude `src/`, `tsconfig*`, test files
- Consumer install smoke test — installs from local tarballs, imports and calls `ask()` with a mock model and fake executor
- Changesets workflow — PR validation (changeset required for publishable changes), `changeset publish` for releases
- Per-package `README.md` with install and minimal usage examples

### Out of scope

- Automated npm publish in CI (manual maintainer step using `changeset publish`)
- Registry mirroring or private registry setup
- CDN/browser bundles

## Design decisions

- **Dialect adapter as the integration seam** — `@askdb/core` is dialect-agnostic. It does not import `pg` or any database driver. Consumers pass a `dialect` adapter; `@askdb/postgres` exports `postgresDialect`. This means `pnpm add @askdb/core` does not pull in any database dependency. See [ADR 0002](../adrs/0002-integration-package-layout.md).
- **`pg` as optional peer dependency** — `@askdb/postgres` declares `pg` as a peer; the lazy-import path throws a helpful error if `pg` is absent and the live executor is requested.
- **Pre-1.0 breaking changes without migrators** — before 1.0, breaking changes ship with a changeset entry describing the break. No compatibility shims. The changeset records the full surface diff.
- **Apps vs packages** — `apps/cli`, `apps/http-api`, `apps/studio` are first-party reference apps (batteries-included). `packages/` contains the published library surface. This boundary is explicit in the monorepo layout.

## Contracts and API surface

Published packages and their primary exports:

| Package | Primary export |
|---|---|
| `@askdb/core` | `ask()`, `AskDbLanguageModel`, schema loader, types, logging factory |
| `@askdb/ai` | `resolveAskDbAiConfig`, `createAskDbAiRegistry`, provider adapter types |
| `@askdb/ai-openai` | OpenAI provider adapter |
| `@askdb/ai-azure` | Azure OpenAI / Foundry provider adapter |
| `@askdb/ai-google` | Google Generative AI provider adapter |
| `@askdb/postgres` | `postgresDialect`, `postgresConnector`, `createPostgresCatalogRunner` |
| `@askdb/introspect` | `introspect()`, `Connector` interface |
| `@askdb/rag` | `chunkSchema()`, `buildSchemaIndex()`, vector store adapters |
| `@askdb/enrich` | `Workspace`, draft/save helpers, bundler |
| `@askdb/tui` | `askdb-tui` binary, terminal enrichment flow |
| `askdb` | `askdb` binary — CLI entry point |

`semver` contract scope: public `index.ts` exports plus contract docs under `docs/contracts/`.

## Test bar

- `pnpm build` and `pnpm test` pass from repo root (Turbo pipeline).
- `pnpm pack` for each publishable package: tarball includes `dist/`, `package.json`, `README.md`, `LICENSE`; excludes `src/`, `tsconfig*`, test files.
- Consumer install smoke: install from local tarballs in a temp directory; import `ask` from `@askdb/core`; call with a mock `LanguageModel` and fake executor; run `tsc --noEmit` on the consumer code.
- `@askdb/core` without `pg` installed: importing `ask` and calling it with a custom executor works; calling it with a connection string produces a clear error mentioning the missing peer.
- Changesets present for any PR that changes publishable package source.
- All existing feature tests remain green after any distribution-related change.
