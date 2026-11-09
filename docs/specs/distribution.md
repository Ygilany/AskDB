# Feature: Distribution

**Status:** Complete  
**Packages:** `@askdb/core`, `@askdb/ai`, `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`, `@askdb/introspect`, `@askdb/rag`, `@askdb/enrich`, `askdb`

## Overview

AskDB packages are published to npm under the `@askdb` scope. The distribution model is developer-first: consumers run `pnpm add @askdb/core ai`, supply their own model and dialect adapter, and call `ask()` from their own runtime. No database connection or API key is bundled.

Release tooling uses changesets for versioning and changelog generation. Packages use semantic versioning. The 12 packages on the 1.0 line share one version, and from `1.0.0-rc.1` their public API is frozen: a breaking change there needs the maintainer's decision first, and after 1.0.0 it is a major version (`docs/release.md`, "Version Posture"). A breaking change ships with a clear changeset entry rather than a migrator.

## Scope

### In scope

- All `@askdb/*` packages and `askdb` CLI published to npm
- `package.json` metadata: `description`, `keywords`, `repository`, `homepage`, `license`, `engines`, `files` (dist only)
- `pnpm pack` validation — tarballs exclude `src/`, `tsconfig*`, test files
- Consumer install smoke test — installs from local tarballs, imports and calls `ask()` with a mock model and fake executor
- Changesets workflow — PR validation (changeset required for publishable changes), a Version PR, and automated npm publish in CI (`.github/workflows/release.yml`, see `docs/release.md`)
- Per-package `README.md` with install and minimal usage examples

### Out of scope

- Registry mirroring or private registry setup
- CDN/browser bundles

## Design decisions

- **Built-in dialect specs in core** — `@askdb/core` owns the built-in dialect specs and imports no database driver. Consumers pass a built-in dialect string (`"postgres"`, `"mysql"`, etc.), a `DialectSpec` under a built-in id, or a custom `AskDialect` adapter. `pnpm add @askdb/core` pulls in no database dependency. See [ADR 0029](../adrs/0029-core-owns-built-in-dialect-specs.md), which supersedes this part of [ADR 0002](../adrs/0002-integration-package-layout.md).
- **Database drivers as optional peer dependencies** — each integration package (`@askdb/postgres`, `@askdb/mysql`, etc.) declares its driver as an optional peer; the lazy-import path throws a clear error if the driver is absent when the live connector is used.
- **CLI hosts connector providers, not drivers** — `askdb` includes first-party connector providers so `askdb introspect` can route by engine, but it does not bundle database drivers. Live connector runners first resolve optional peers from their normal package graph, then from the caller's project so ephemeral CLI launches can use drivers installed with the application or supplied in the same `npx`/`pnpm dlx` command.
- **Breaking changes without migrators** — a breaking change ships with a changeset entry describing the break: a `major` for the 1.0 set (frozen from `1.0.0-rc.1` unless the maintainer decides otherwise), and a `minor` for the 0.x packages and the experimental surfaces (`docs/release.md`, "Version Posture"). No compatibility shims. The changeset records the full surface diff.
- **Apps vs packages** — `apps/cli`, `apps/http-api`, `apps/studio` are first-party reference apps (batteries-included). `packages/` contains the published library surface. This boundary is explicit in the monorepo layout.

## Contracts and API surface

Published packages and their primary exports:

| Package | Primary export |
|---|---|
| `@askdb/core` | `ask()`, `AskDbLanguageModel`, schema loader, types, logging factory |
| `@askdb/ai` | `createAiRegistry`, `AiRegistry`, provider adapter types, `BUILTIN_AI_PROVIDERS`, and the built-in adapters (`openaiProvider`, `azureProvider`, `googleProvider`, `anthropicProvider`, `gatewayProvider`); `@ai-sdk/*` SDKs are optional peers |
| `@askdb/postgres` | `postgresDialect`, `postgresConnectorProvider`, `postgresConnector`, `createPostgresCatalogRunner` |
| `@askdb/mysql` | `mysqlConnectorProvider` |
| `@askdb/sqlite` | `sqliteConnectorProvider` |
| `@askdb/sqlserver` | `sqlServerConnectorProvider` |
| `@askdb/prisma` | Prisma `ConnectorProviderAdapter` |
| `@askdb/introspect` | `introspect()`, `Connector` interface, `createConnectorRegistry` / `ConnectorProviderAdapter`; `@askdb/introspect/kit` engine helpers |
| `@askdb/rag` | `chunkSchema()`, `buildSchemaIndex()`, vector store adapters |
| `@askdb/enrich` | `Workspace`, draft/save helpers, bundler |
| `askdb` | `askdb` binary — CLI entry point |

`semver` contract scope: public `index.ts` exports plus contract docs under `docs/contracts/`.

## Test bar

- `pnpm build` and `pnpm test` pass from repo root (Turbo pipeline).
- `pnpm pack` for each publishable package: tarball includes `dist/`, `package.json`, `README.md`, `LICENSE`; excludes `src/`, `tsconfig*`, test files.
- Consumer install smoke: install from local tarballs in a temp directory; import `ask` from `@askdb/core`; call with a mock `LanguageModel` and fake executor; run `tsc --noEmit` on the consumer code.
- `@askdb/core` without a database driver installed: importing `ask` and calling it with a custom executor works.
- `askdb` without `pg` installed: non-live commands and SQL-template introspection commands work; live Postgres introspection fails with a clear missing-peer error until `pg` is installed in the project or supplied in the same ephemeral command.
- Changesets present for any PR that changes publishable package source.
- All existing feature tests remain green after any distribution-related change.
