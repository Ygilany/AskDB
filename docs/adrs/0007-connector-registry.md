# ADR 0007 — Connector provider registry (`@askdb/connectors`)

## Status

Proposed.

## Context

ADR 0002 established that adding a new integration only requires a new package, with no core or
introspect changes. The consequence is that each integration package exports its own
`create<Engine>Connector()` factory and `create<Engine>CatalogQueryRunner()`.

First-party apps — principally the CLI's `apps/cli/src/introspect.ts` — must know about every
concrete integration package and switch over the engine name at runtime. Without a registry,
every consumer must import all concrete packages and re-implement the dispatch switch.

### Why this is different from the AI registry

For AI (ADR 0006), users pick *one* provider; the `@askdb/ai` package stays light and the CLI
explicitly registers the three adapters it supports. For connectors, every CLI invocation needs
*any* of the five engines depending on what the user configured. The CLI always needs all of them.

This asymmetry makes a batteries-included design the right choice for connectors:
`@askdb/connectors` owns both the registry abstraction and the pre-built default registry. The
CLI imports a single symbol and never names a concrete database package.

### Dependency direction

The natural direction is: `CLI → @askdb/connectors → concrete packages → @askdb/introspect`.

Having concrete packages *also* depend on `@askdb/connectors` for its adapter type would create a
circular package dependency (`connectors → postgres → connectors`). The solution is structural
typing: concrete packages define their adapter shape using types from `@askdb/introspect` (which
they already depend on). TypeScript's structural checker verifies compatibility at the call site
inside `@askdb/connectors`. No circular dep, no extra cross-dependency.

## Decision

Create `@askdb/connectors` — a workspace package published as `@askdb/connectors` — as the
batteries-included connector registry for first-party apps.

### `@askdb/connectors`

Owns:
- `AskDbConnectorProvider` — `"postgres" | "prisma" | "mysql" | "sqlite" | "sqlserver"`.
- `AskDbConnectorConfig` — unified per-call config (provider + url/fromExport/schemaPath/filters/schemaId).
- `AskDbConnectorResult` — `{ connector: Connector<unknown>; input: unknown; mode: string }`.
- `AskDbConnectorProviderAdapter` — the interface each concrete package implements (includes optional `getTemplates?()`).
- `AskDbConnectorRegistry` — `{ hasProvider, createConnector, getTemplates }`.
- `createAskDbConnectorRegistry(adapters)` — factory for custom registries.
- `connectorRegistry` — pre-built registry containing all five first-party adapters, exported for CLI and other apps that support all engines.

Dependency model:
- `@askdb/introspect`: hard dependency, for `Connector<TInput>`, `IntrospectionFilters`, `SqlTemplateBundle`.
- All five concrete packages as regular runtime dependencies.

### Concrete packages

Each package exports a provider adapter constant using local types sourced from `@askdb/introspect`.
TypeScript structural typing ensures the exported shape satisfies `AskDbConnectorProviderAdapter`.
No concrete package depends on `@askdb/connectors`.

- `@askdb/postgres` → `postgresConnectorProvider` (live + from-export modes, implements `getTemplates()`).
- `@askdb/mysql` → `mysqlConnectorProvider`.
- `@askdb/sqlite` → `sqliteConnectorProvider`.
- `@askdb/sqlserver` → `sqlServerConnectorProvider`.
- `@askdb/prisma` → `prismaConnectorProvider`.

### First-party apps

Apps import `connectorRegistry` and are done. No adapter imports, no registry instantiation:

```ts
import { connectorRegistry, type AskDbConnectorConfig } from "@askdb/connectors";

const { connector, input, mode } = connectorRegistry.createConnector({
  provider: engine,
  url,
  fromExport,
  schemaPath,
  filters,
  schemaId,
});

// Templates (postgres-specific capability surfaced generically):
const bundle = connectorRegistry.getTemplates("postgres");
```

### Dependency graph (CLI)

```
askdb (CLI)
  └─ @askdb/connectors
       ├─ @askdb/introspect
       ├─ @askdb/postgres  ──► @askdb/introspect, @askdb/core
       ├─ @askdb/mysql     ──► @askdb/introspect, @askdb/core
       ├─ @askdb/sqlite    ──► @askdb/introspect, @askdb/core
       ├─ @askdb/sqlserver ──► @askdb/introspect, @askdb/core
       └─ @askdb/prisma    ──► @askdb/introspect
```

## Rationale

- **Single responsibility for the CLI.** The CLI resolves URLs and validates flags; it does not
  know which engines exist. Engine knowledge lives entirely in `@askdb/connectors`.
- **Clean dependency direction.** `CLI → connectors → concrete` — one-way, no cycles.
- **Structural typing avoids coupling.** Concrete packages express adapter shape using
  `@askdb/introspect` types they already depend on. No circular dep, no artificial type package.
- **`@askdb/introspect` stays engine-agnostic.** It defines `Connector<TInput>`, `SqlTemplateBundle`,
  and `IntrospectionFilters`, all of which are the right seams for the adapter shape.
- **Templates are a generic capability.** `getTemplates?()` on the adapter and `getTemplates(provider)`
  on the registry expose this cleanly without the CLI importing any concrete package directly.

## Consequences

- The CLI's direct dependencies on `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`,
  `@askdb/sqlserver`, and `@askdb/prisma` are removed; all five arrive transitively through
  `@askdb/connectors`.
- Library users who want only one engine install that engine's package and call
  `createAskDbConnectorRegistry([postgresConnectorProvider])` directly — the factory is still
  exported for custom registries.
- `@askdb/connectors` is a heavyweight registry (pulls in five database packages). This is
  intentional: it is the app-bootstrap layer, not a library component.

## Out of scope

- Runtime query execution — connectors are for introspection only.
- Moving `DialectSpec` out of `@askdb/core`.
- Optional peer dep + dynamic loading pattern — deferred; the batteries-included design is
  sufficient for all current first-party use cases.

## Related

- ADR 0002 — Integration-package layout.
- ADR 0006 — AI provider integration strategy.
- `packages/connectors/src/registry.ts` — registry implementation.
- `packages/connectors/src/default-registry.ts` — pre-built default registry.
- `packages/ai/src/provider.ts` — AI registry (different distribution model but parallel pattern).
