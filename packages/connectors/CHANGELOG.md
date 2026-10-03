# @askdb/connectors

## 0.1.0-beta.9

### Minor Changes

- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.

### Patch Changes

- Updated dependencies [9021e54]
  - @askdb/introspect@0.3.0-beta.18

## 0.1.0-beta.8

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- Updated dependencies [ab2150b]
- Updated dependencies [2787b21]
  - @askdb/introspect@0.3.0-beta.17

## 0.1.0-beta.7

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [1131e77]
  - @askdb/introspect@0.3.0-beta.16

## 0.1.0-beta.6

### Patch Changes

- @askdb/introspect@0.3.0-beta.15

## 0.1.0-beta.5

### Patch Changes

- @askdb/introspect@0.3.0-beta.14

## 0.1.0-beta.4

### Patch Changes

- @askdb/introspect@0.3.0-beta.13

## 0.1.0-beta.3

### Patch Changes

- @askdb/introspect@0.3.0-beta.12

## 0.1.0-beta.2

### Patch Changes

- @askdb/introspect@0.3.0-beta.11

## 0.1.0-beta.1

### Minor Changes

- efe4a1b: **Ship `@askdb/connectors` — connector provider registry for app/bootstrap wiring.**

  Introduces `@askdb/connectors`, a new workspace package that mirrors the `@askdb/ai` registry pattern for introspection connectors. It provides a provider adapter abstraction and registry factory that concrete database packages register into, replacing per-app switch statements over engine names.

  **`@askdb/connectors`** exports:
  - `createAskDbConnectorRegistry(adapters)` — factory that accepts an array or object-map of provider adapters and returns a registry with `hasProvider()` and `createConnector(config)`.
  - `AskDbConnectorConfig` — unified config shape (`provider`, `url`, `fromExport`, `schemaPath`, `filters`, `schemaId`).
  - `AskDbConnectorResult` — `{ connector, input, mode }` pair consumed by `introspect()`.
  - `AskDbConnectorProviderAdapter` — interface each concrete package implements.
  - `ASKDB_CONNECTOR_PROVIDERS` and `AskDbConnectorProvider` type.
  - `askDbConnectorProviderMissingMessage()` helper for actionable error messages.

  **New provider adapter exports** from each concrete package:
  - `@askdb/postgres` → `postgresConnectorProvider` (live + from-export modes)
  - `@askdb/mysql` → `mysqlConnectorProvider`
  - `@askdb/sqlite` → `sqliteConnectorProvider`
  - `@askdb/sqlserver` → `sqlServerConnectorProvider`
  - `@askdb/prisma` → `prismaConnectorProvider`

  **CLI update:** `apps/cli` now wires all five connector providers through `createAskDbConnectorRegistry` instead of the inline switch in `buildRunConfig`. The CLI's URL resolution and validation logic is unchanged; only the connector/input construction path uses the registry.

### Patch Changes

- @askdb/introspect@0.3.0-beta.10
