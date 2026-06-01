# ADR 0007 — Connector provider registry (`@askdb/connectors`)

## Status

Proposed.

## Context

ADR 0002 established that adding a new integration only requires a new package, with no core or
introspect changes. Each integration package exports its own `create<Engine>Connector()` factory
and `create<Engine>CatalogQueryRunner()`.

First-party apps — principally the CLI's `apps/cli/src/introspect.ts` — must know about every
concrete integration package and switch over the engine name at runtime. Without a registry,
every consumer must import all concrete packages and re-implement the dispatch switch.

This is the same problem that motivated `@askdb/ai` for AI providers (ADR 0006).

## Design layers

```
@askdb/introspect
  low-level, engine-agnostic contract:
  Connector<TInput>, introspect(input, renderOptions, { connector })

@askdb/connectors
  higher-level bootstrap registry:
  AskDbConnectorProviderAdapter, createAskDbConnectorRegistry
  "given AskDB config, pick the right concrete connector adapter"

@askdb/postgres, @askdb/mysql, @askdb/sqlite, @askdb/sqlserver, @askdb/prisma
  each depends on @askdb/connectors and exports a provider adapter constant

apps (CLI, etc.)
  depends on @askdb/connectors + each concrete package
  wires adapters into the registry at startup
```

## Decision

Create `@askdb/connectors` — a lightweight workspace package published as `@askdb/connectors` —
as the shared registry and adapter layer for introspection connectors. Follow Option F from
ADR 0006: the registry package owns types and the factory; concrete packages export adapters.

### `@askdb/connectors`

Owns:
- `AskDbConnectorProvider` — `"postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"`.
- `AskDbConnectorConfig` — unified per-call config (provider + url/fromExport/schemaPath/filters/schemaId).
- `AskDbConnectorResult` — `{ connector: Connector<unknown>; input: unknown; mode: string }`.
- `AskDbConnectorProviderAdapter` — the interface each concrete package implements (includes optional `getTemplates?()`).
- `AskDbConnectorRegistry` — `{ hasProvider, createConnector, getTemplates }`.
- `createAskDbConnectorRegistry(adapters)` — registry factory.
- `askDbConnectorProviderMissingMessage()` — actionable error helper.

Dependency model:
- `@askdb/introspect`: hard dependency (for `Connector<TInput>`, `IntrospectionFilters`, `SqlTemplateBundle`).
- **No dependency on any concrete database package.** The registry stays lightweight; users
  install only the concrete packages their runtime uses.

### Concrete packages

Each package depends on `@askdb/connectors` and exports a provider adapter constant typed as
`AskDbConnectorProviderAdapter`. The `import type` in each package is erased at compile time,
so there is no circular runtime dependency:

```
@askdb/connectors (registry/types, runtime: no concrete deps)
  ← depends on (type-only, erased in JS output)
@askdb/postgres (exports postgresConnectorProvider: AskDbConnectorProviderAdapter)
```

- `@askdb/postgres` → `postgresConnectorProvider` (live + from-export, implements `getTemplates()`).
- `@askdb/mysql` → `mysqlConnectorProvider`.
- `@askdb/sqlite` → `sqliteConnectorProvider`.
- `@askdb/sqlserver` → `sqlServerConnectorProvider`.
- `@askdb/prisma` → `prismaConnectorProvider`.

All existing `create<Engine>Connector()` and `create<Engine>CatalogQueryRunner()` exports are
retained unchanged.

### First-party apps

Apps import the factory from `@askdb/connectors` and the adapter constants from each concrete
package they intentionally support:

```ts
import { createAskDbConnectorRegistry } from "@askdb/connectors";
import { postgresConnectorProvider } from "@askdb/postgres";
import { mysqlConnectorProvider } from "@askdb/mysql";
import { sqliteConnectorProvider } from "@askdb/sqlite";
import { sqlServerConnectorProvider } from "@askdb/sqlserver";
import { prismaConnectorProvider } from "@askdb/prisma";

const connectors = createAskDbConnectorRegistry([
  postgresConnectorProvider,
  mysqlConnectorProvider,
  sqliteConnectorProvider,
  sqlServerConnectorProvider,
  prismaConnectorProvider,
]);

// Introspection:
const { connector, input, mode } = connectors.createConnector({
  provider: engine,
  url,
  fromExport,
  schemaPath,
  filters,
  schemaId,
});

// Templates (surfaced generically — no direct postgres import needed):
const bundle = connectors.getTemplates("postgres");
```

Apps declare only the adapter packages they support. A hypothetical embedded deployment that
only supports postgres installs `@askdb/postgres`, imports `postgresConnectorProvider`, and
passes it to `createAskDbConnectorRegistry`.

## Rationale

- **Mirrors ADR 0006 (Option F).** Same structural split as `@askdb/ai` / `@askdb/ai-*`:
  registry package owns the abstraction, concrete packages own the implementation.
- **`@askdb/connectors` stays lightweight.** It has one runtime dependency (`@askdb/introspect`).
  Users who only use postgres do not pay for mysql or prisma packages.
- **`@askdb/introspect` stays engine-agnostic.** It defines `Connector<TInput>` and
  `introspect()`. The registry layer in `@askdb/connectors` is the right place for
  config-to-adapter dispatch.
- **No circular runtime dependency.** Concrete packages use `import type` from `@askdb/connectors`,
  which TypeScript erases entirely in the JS output. The runtime module graph is acyclic.
- **Templates are surfaced generically.** `getTemplates?()` on the adapter and `getTemplates(provider)`
  on the registry expose engine-specific capabilities without requiring callers to import a
  concrete package for a capability check.

## Consequences

- `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, and `@askdb/prisma`
  gain `@askdb/connectors` as a direct runtime dependency (for the adapter type).
- The CLI's inline engine switch in `buildRunConfig` is replaced by `createAskDbConnectorRegistry`
  + `registry.createConnector(config)`.
- Library consumers who do not want the registry layer continue to call
  `create<Engine>Connector()` and `create<Engine>CatalogQueryRunner()` directly — nothing is
  removed from those packages.
- Adding a new engine integration adds a new package + adapter export; no changes to
  `@askdb/connectors`, `@askdb/introspect`, or `@askdb/core`.

## Out of scope

- Runtime query execution — connectors are for introspection only.
- Moving `DialectSpec` out of `@askdb/core`.
- Auto-registration or dynamic loading of adapters.

## Related

- ADR 0002 — Integration-package layout.
- ADR 0006 — AI provider integration strategy (Option F).
- `packages/connectors/src/registry.ts` — registry implementation.
- `packages/ai/src/provider.ts` — AI registry (parallel pattern).
