# Feature: Distribution

**Status:** Complete  
**Packages:** `@askdb/core`, `@askdb/ai`, `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/connectors`, `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`, `@askdb/introspect`, `@askdb/rag`, `@askdb/enrich`, `askdb`

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

- **Dialect adapter as the integration seam** — `@askdb/core` is dialect-agnostic and imports no database driver. Consumers pass a built-in dialect string (`"postgres"`, `"mysql"`, etc.) or a custom `AskDialect` adapter. `pnpm add @askdb/core` pulls in no database dependency. See [ADR 0002](../adrs/0002-integration-package-layout.md).
- **Database drivers as optional peer dependencies** — each integration package (`@askdb/postgres`, `@askdb/mysql`, etc.) declares its driver as an optional peer; the lazy-import path throws a clear error if the driver is absent when the live connector is used.
- **CLI hosts connector providers, not drivers** — `askdb` includes first-party connector providers so `askdb introspect` can route by engine, but it does not bundle database drivers. Live connector runners first resolve optional peers from their normal package graph, then from the caller's project so ephemeral CLI launches can use drivers installed with the application or supplied in the same `npx`/`pnpm dlx` command.
- **Pre-1.0 breaking changes without migrators** — before 1.0, breaking changes ship with a changeset entry describing the break. No compatibility shims. The changeset records the full surface diff.
- **Apps vs packages** — `apps/cli`, `apps/http-api`, `apps/studio` are first-party reference apps (batteries-included). `packages/` contains the published library surface. This boundary is explicit in the monorepo layout.

## Contracts and API surface

Published packages and their primary exports:

| Package | Primary export |
|---|---|
| `@askdb/core` | `ask()`, `AskDbLanguageModel`, schema loader, types, logging factory |
| `@askdb/ai` | `resolveAiConfig`, `createAiRegistry`, `AiRegistry`, provider adapter types |
| `@askdb/ai-openai` | OpenAI `AiProviderAdapter` |
| `@askdb/ai-azure` | Azure OpenAI / Foundry `AiProviderAdapter` |
| `@askdb/ai-google` | Google Generative AI `AiProviderAdapter` |
| `@askdb/connectors` | `createConnectorRegistry`, `ConnectorRegistry`, `ConnectorProviderAdapter` types |
| `@askdb/postgres` | `postgresDialect`, `postgresConnectorProvider`, `postgresConnector`, `createPostgresCatalogRunner` |
| `@askdb/mysql` | `mysqlConnectorProvider` |
| `@askdb/sqlite` | `sqliteConnectorProvider` |
| `@askdb/sqlserver` | `sqlserverConnectorProvider` |
| `@askdb/prisma` | Prisma `ConnectorProviderAdapter` |
| `@askdb/introspect` | `introspect()`, `Connector` interface |
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
