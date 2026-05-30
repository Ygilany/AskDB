# ADR 0007 — Connector provider registry (`@askdb/connectors`)

## Status

Proposed.

## Context

ADR 0002 established that adding a new integration only requires a new package, with no core or introspect changes. The consequence is that each integration package (`@askdb/postgres`, `@askdb/mysql`, etc.) exports its own `create<Engine>Connector()` factory.

First-party apps — principally the CLI's `apps/cli/src/introspect.ts` — must know about every concrete integration package and switch over the engine name at runtime:

```ts
if (engine === "postgres") {
  return {
    input: { mode: "live", runner: createPostgresCatalogQueryRunner(url), filters },
    connector: createPostgresConnector() as Connector<unknown>,
    mode: "live",
  };
}
if (engine === "mysql") { ... }
// etc.
```

This is the same problem that motivated `@askdb/ai` for AI providers (ADR 0006). Without a registry, every consumer must:

1. Import all concrete packages it potentially supports.
2. Re-implement the dispatch switch.
3. Absorb breaking changes from each concrete package directly.

### Asymmetry between AI and connector registries

Unlike AI models (`LanguageModel` from the Vercel AI SDK), each connector engine has a **different input type** (`PostgresIntrospectionInput`, `MysqlIntrospectionInput`, `PrismaIntrospectionInput`, etc.). The registry cannot expose a single generic `createConnector(config)` that returns a `Connector<ConcreteInput>` — it must cast to `Connector<unknown>` before returning, which is already what the CLI does today with `as Connector<unknown>`.

The unified `AskDbConnectorConfig` covers all engine inputs with optional fields: `url` (live URL or file path), `fromExport` (postgres bundle path), `schemaPath` (prisma), `filters`, and `schemaId`.

## Decision

Create `@askdb/connectors` — a workspace package published as `@askdb/connectors` — as the shared registry and adapter layer for introspection connectors. Mirror the structure of `@askdb/ai`.

### `@askdb/connectors`

Owns:
- `AskDbConnectorProvider` — `"postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"`.
- `AskDbConnectorConfig` — unified per-call config (provider + url/fromExport/schemaPath/filters/schemaId).
- `AskDbConnectorResult` — `{ connector: Connector<unknown>; input: unknown; mode: string }`.
- `AskDbConnectorProviderAdapter` — the interface each concrete package implements.
- `createAskDbConnectorRegistry(adapters)` — factory that accepts adapters (array or object-map) and returns a registry with `hasProvider()` and `createConnector()`.
- `askDbConnectorProviderMissingMessage()` — actionable error helper.

Dependency model:
- `@askdb/introspect`: hard dependency, for `Connector<TInput>` and `IntrospectionFilters`.
- No concrete database packages.
- No dependency on `@askdb/config`; `AskDbConnectorProvider` is defined independently to keep concrete packages' transitive dep graph small.

### Concrete packages

Each package adds a provider adapter constant as a new named export and depends on `@askdb/connectors`:

- `@askdb/postgres` → `postgresConnectorProvider` (live + from-export modes).
- `@askdb/mysql` → `mysqlConnectorProvider`.
- `@askdb/sqlite` → `sqliteConnectorProvider`.
- `@askdb/sqlserver` → `sqlServerConnectorProvider`.
- `@askdb/prisma` → `prismaConnectorProvider`.

All existing connector/runner exports are retained unchanged.

### First-party apps

Apps that currently switch on engine replace the switch with a registry call:

```ts
import { createAskDbConnectorRegistry, type AskDbConnectorConfig } from "@askdb/connectors";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

const registry = createAskDbConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);

const { connector, input, mode } = registry.createConnector({
  provider: engine,
  url,
  fromExport,
  schemaPath,
  filters,
  schemaId,
});
```

## Rationale

- **Mirrors ADR 0006.** The AI provider registry solved the same dispatch problem for language models. Applying the same pattern to connectors keeps the architecture consistent.
- **`@askdb/core` stays clean.** No connector construction logic enters `@askdb/core`.
- **`@askdb/introspect` stays the owner of `Connector<TInput>`.** The registry composes on top of `Connector`; it does not redefine the interface.
- **Adding a new engine is still self-contained.** A new `@askdb/<engine>` package exports its own adapter; apps opt in by registering it.

## Consequences

- `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, and `@askdb/prisma` gain `@askdb/connectors` as a direct (non-peer) runtime dependency.
- The CLI's `buildRunConfig` switch is replaced by a registry call. URL resolution and validation logic is unchanged.
- Library consumers who do not want the registry layer continue to call `create<Engine>Connector()` directly — nothing is removed.

## Out of scope

- Runtime query execution — connectors are for introspection only.
- Moving `DialectSpec` out of `@askdb/core`.
- Auto-registration or dynamic plugin loading.

## Related

- ADR 0002 — Integration-package layout.
- ADR 0006 — AI provider integration strategy.
- `packages/connectors/src/registry.ts` — registry implementation.
- `packages/ai/src/provider.ts` — AI registry (parallel pattern).
