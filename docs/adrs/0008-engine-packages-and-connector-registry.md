# ADR 0008 — Engine packages, the shared engine kit, and the connector registry in `@askdb/introspect`

## Status

Accepted (2026-09-25). Decisions 1 and 2 (the engine kit) landed with #195; decisions 3 to 5 (the registry move, connection resolution, the `@askdb/connectors` shim) with #199 (2026-10-09).

2026-11: the `@askdb/connectors` shim from decision 5 was removed before 1.0 (#347). Its last version on npm is `0.1.0-beta.9`. Code imports the registry from `@askdb/introspect` and the connection-label helpers from `@askdb/introspect/kit`.

Amended 2026-11-05: a registered adapter can load on first use (lazy entries and `registry.load()`; #339, #259). See [Amendment (2026-11-05)](#amendment-2026-11-05-registered-adapters-can-load-on-first-use).

Supersedes in part:
- [ADR 0002](0002-integration-package-layout.md): the rule that integration packages own their SQL dialect, and the rule that `@askdb/introspect` declares no source kinds (its registry's connection now names three: `url`, `fromExport`, `schemaPath`; connector inputs stay engine-owned).
- [ADR 0007](0007-connector-registry.md): where the connector registry lives, and its closed provider union.

## Context

ADR 0002 organized AskDB around one package per integration. Each integration owned its dialect, connector, input shape, and catalog runner. ADR 0007 added `@askdb/connectors` as a registry so apps could dispatch on a config-selected engine without a hand-written switch. Since then, three things have changed.

1. **Dialects moved to core** ([ADR 0002](0002-integration-package-layout.md), 2026-10 amendment). The dialect specs now live in `@askdb/core` (`packages/core/src/sql/dialect-spec.ts`): `POSTGRES_DIALECT`, `MYSQL_DIALECT`, `SQLITE_DIALECT`, `SQLSERVER_DIALECT`, and the rest. `ask()` takes a dialect id, and engine packages only re-export their spec. What an engine package owns today is introspection: catalog SQL, row shapes, the optional driver peer, connection-string formats, and connection resolution.
2. **The engine packages had grown by copy-paste.** About 700 lines were duplicated across `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, and `@askdb/prisma`:
   - byte-identical `glob.ts` and `ids.ts`
   - four ~95-line optional-driver loaders that differed only in the package name
   - the row→record mapper, `groupBy`, `byName`, the FK-action mapping, and the unique/FK/index group-and-sort loops
   - the `ambiguous_filter` loop
   - four near-identical `provider.ts` files
3. **The registry was closed, and the apps still switched on engines.** `ConnectorProvider` was a closed union (`CONNECTOR_PROVIDERS`), so a third-party engine could not register without editing `@askdb/connectors`. That contradicts ADR 0002's promise that a new engine is a self-contained package addition. The CLI (`apps/cli/src/introspect.ts`) and Studio (`apps/studio/src/introspection.ts`) also still had their own per-engine switches. Each switch decided which config value is the connection, whether flags override it, and which flags are illegal for which engine. The registry picked the adapter, but every app still hard-coded what each engine needs.

## Decision

1. **Keep one package per engine.** Driver peers stay optional and engine-local (`pg`, `mysql2`, `better-sqlite3`, `mssql`), and catalog SQL stays engine-specific. The engine packages do not collapse into one package.
2. **Add a shared engine kit at `@askdb/introspect/kit`.** It is a subpath export, importable and requireable, and holds only engine-agnostic mechanics:
   - `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` / `rethrowDriverImportError`
   - `compileTableFilters` / `ambiguousFilterWarnings`
   - `makeTableId` / `makeColumnId`
   - `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`
   - the connection-label helpers (`formatConnectionLabel`, `parseConnectionUrl`; [ADR 0011](0011-connection-labels-from-parsed-parts.md))
   - `defineLiveConnectorProvider`, the adapter for engines that introspect only through a live `CatalogQueryRunner`

   Every first-party engine is built on the kit. Each engine still writes its driver's `import()` literally in its own package, with `.catch(rethrowDriverImportError)` chained on it, so bundlers see the peer where it is declared and treat it as optional.
3. **Move the connector registry into `@askdb/introspect` and open its provider ids.**
   - `createConnectorRegistry`, `ConnectorProviderAdapter`, `ConnectorConfig`, and `ConnectorRegistry` are exported from `@askdb/introspect`.
   - The provider id is typed `ConnectorProviderId = BuiltInConnectorProvider | (string & {})`. Any string is valid, and the built-in ids still autocomplete.
   - Unregistered built-in ids still get an `Install @askdb/<id>` hint.
4. **Adapters own connection resolution; the registry builds the label.** `ConnectorProviderAdapter` gains an optional `resolveConnection({ explicit?, runtime, surface? })` hook. It turns explicit values (CLI flags) plus AskDB runtime config (`getAskDbRuntimeConfig()`, typed structurally so engines do not depend on `@askdb/config`) into `{ url?, fromExport?, schemaPath? }`, or an error that must not echo the connection string. `surface: "cli"` makes error messages name flags; other surfaces name config keys. The adapter's `connectionLabelParts` hook (from #189) supplies the label's parts; the adapter never returns label text ([ADR 0011](0011-connection-labels-from-parsed-parts.md)).

   The registry exposes `registry.resolveConnection(provider, request)`, which returns the adapter's result plus `sourceLabel = registry.connectionLabel(provider, connection)`. When an adapter has no `resolveConnection`, the registry passes `explicit` through; when it has no `connectionLabelParts`, the label is `configured <provider> connection`. The CLI and Studio switches are deleted. Both apps now dispatch through the registry, and the CLI accepts an injected registry (`runIntrospectCli(argv, { connectorRegistry })`).

   The connection is one of the three source kinds a host can supply, `url`, `fromExport` or `schemaPath`, the fields ADR 0007's `ConnectorConfig` already had (`ConnectorConnection`). An engine whose source is something else maps it onto one of them, usually `url`; its connector input type stays engine-owned, as ADR 0002 requires, because `createConnector` builds it.

5. **Deprecate `@askdb/connectors`.** It stays published as a re-export shim of the registry and the kit's connection-label helpers. `CONNECTOR_PROVIDERS` is kept as an alias of `BUILT_IN_CONNECTOR_PROVIDERS`, and `ConnectorProvider` as an alias of `ConnectorProviderId`. Engine packages and first-party apps no longer depend on it.

## Rationale

- **The registry belongs next to the contract it dispatches.** `Connector<TInput>` and `introspect()` are in `@askdb/introspect`, and so is the registry now. A separate package bought a second install and a second version to keep in step, and it hid nothing, because every engine already depends on `@askdb/introspect`.
- **Open ids are what ADR 0002 promised.** With `(string & {})`, a third-party `@acme/askdb-oracle` package registers `provider: "oracle"` without any AskDB change, and editors still suggest the built-in ids.
- **Connection resolution is engine knowledge.** Which config value is the connection, whether `--from-export` applies, and how a DSN is parsed into a display label are all engine-specific facts. They belong in the engine package, the same way catalog SQL does. The apps keep only engine-agnostic rules, such as `--url` and `--from-export` being mutually exclusive, output modes, and logging.
- **A kit, not a base class.** The kit is a set of plain functions. Engines take what they need, and nothing constrains their catalog SQL or input shapes.
- **One copy to fix.** Driver-error classification (a missing peer versus an installed one that fails to load), glob matching and the label allowlist each live once, so a fix reaches every engine.

## Alternatives considered

- **Keep the registry in `@askdb/connectors` and open its ids there (rejected).** It fixes the closed union but keeps a second package that every engine and app installs and versions in step, and that hides nothing, since every engine already depends on `@askdb/introspect`.
- **Keep connection resolution in the apps, driven by a per-engine table (rejected).** A table in the CLI and Studio of "which config key, which flags" is the per-engine switch ADR 0007 rules out under another name, and a third-party engine still couldn't add its row.
- **Let the adapter return the display label from `resolveConnection` (rejected).** It makes the allowlist optional, which ADR 0011 rejects (its option A2): the registry builds `sourceLabel` from the adapter's parts.
- **An engine-defined connection type instead of the three source kinds (rejected for now).** The hosts can only supply a URL, an export bundle or a schema path, so a free-form type would give the CLI and Studio nothing to fill in; an engine with a richer source maps it onto `url`.
- **Remove `@askdb/connectors` now (rejected).** Pre-1.0 consumers import from it; a re-export shim costs nothing and a future major can drop it.

## Consequences

- About 600 lines leave the engine packages. A new engine gets driver loading, filters, ids, row folding, connection labels, and, for live-only engines, a full `ConnectorProviderAdapter` from the kit.
- The kit's driver loader throws `AskDbError`, so importing the kit loads `@askdb/core`, as `@askdb/introspect`'s main entry already does; documented installs of these packages list `ai`, `@askdb/core`'s peer.
- A third-party engine plugs into any registry-driven host, programmatic or custom, without AskDB changes. The CLI's introspect command is written against an injected registry: `runIntrospectCli(argv, { connectorRegistry })` is internal and covered by a test that uses a custom adapter. So it contains no engine-specific code. The shipped `askdb` binary still registers only the first-party engines. There is no auto-discovery; see "Out of scope".
- The CLI and Studio keep their user-facing error messages. Two visible changes: `askdb introspect templates --engine prisma` now reports the generic "does not provide SQL templates" message instead of a Prisma-specific one, and Studio labels a Prisma source with no configured schema path `configured prisma connection` instead of `auto-discovered prisma/schema.prisma`, because labels come only from the adapter's parsed parts and the path isn't known until the connector discovers it.
- `@askdb/config`'s `introspection.provider` is still a closed union in the typed config. Opening the typed config to third-party engines is separate work. A third-party adapter can already read its own block from `runtime.structured` (`introspection.providerConfig.<id>`, which `@askdb/config` passes through untyped). Adapters don't read `process.env` (ADR 0005).
- `@askdb/connectors` consumers keep working. The widening from a closed union to an open string is the one type-level change: it reaches `ConnectorProvider` and the `provider` type of each engine package's exported adapter, so `@askdb/connectors` and the five engine packages are released as minors.

## Amendment (2026-11-05): registered adapters can load on first use

### Context

`@askdb/prisma` depends on `@prisma/internals`, and through it on `@prisma/engines`, whose install script pnpm 11 refuses to run until it is approved. Because `askdb` and `@askdb/studio` depended on `@askdb/prisma`, `pnpm add askdb` exited 1 for every pnpm 11 user, Prisma or not (#259). The maintainer chose to make `@askdb/prisma` an optional peer of both. A host can't import an optional peer at startup, so the registry has to hold an engine it hasn't loaded. Loading it at startup also made every `askdb` command, `--help` included, pay for Prisma (#339).

### Decision

1. A registry entry is an adapter or a **lazy entry**, `{ provider, load(): Promise<ConnectorProviderAdapter> }` (`LazyConnectorProviderAdapter`), in both the array and the object-map forms.
2. `hasProvider()` and `providers()` answer from the entry's id without loading it.
3. `registry.load(provider)` returns the adapter. For a lazy entry it calls `load()` once, shares the call between concurrent callers, retries after a failure, and rejects when the loaded adapter's `provider` differs from the entry's. An adapter object resolves as it is.
4. The other methods stay synchronous. For a lazy entry that isn't loaded yet they throw `Connector provider "<id>" is not loaded yet`, naming `registry.load()`. They fail closed: `connectionLabel` doesn't fall back to `configured <id> connection`, and `getTemplates` doesn't report "no templates".
5. `load()`'s errors reach the caller unchanged, so the install hint for a missing package belongs to the entry's `load`. The first-party hosts build it with the kit's `createOptionalDriverLoader` (the host's own install first, then the project in the working directory, as for drivers) and `connectorPackageMissingMessage({ provider, packageName, allowBuilds })`, whose `pnpm add` command approves the builds the package needs.
6. The CLI and Studio register `@askdb/prisma` as a lazy entry and call `registry.load()` once the engine is selected. The four live engines stay adapter objects: they are hard dependencies, so loading them lazily would change no install.

### Alternatives considered

- **Make every adapter method async (rejected).** A forgotten `await` would be a type error, not a runtime one. But it breaks every host and every docs example for a laziness only one entry needs, on top of the install change Prisma users already get.
- **An `engine === "prisma"` branch in the CLI (rejected in #183).** It bypasses the registry (ADR 0007: apps don't re-implement per-engine switches), and Studio would still diverge.
- **Keep `@askdb/prisma` a dependency and document the approval (#259 option 1, rejected).** Every pnpm 11 user would approve a build that only Prisma users need.
- **Keep `@askdb/prisma` a dependency and drop the build from its dependencies (#259 option 2, rejected).** `@askdb/prisma` reads the schema with `@prisma/internals` (`getConfig`, `getDMMF`), which depends on `@prisma/engines`. Dropping the build means parsing the schema without `@prisma/internals`, a separate change to `@askdb/prisma`, and every `askdb` user would still install Prisma for an engine most of them don't use.

### Consequences

- A host that registers only adapter objects changes nothing.
- A host that registers a lazy entry must call `registry.load()` before the synchronous methods. Forgetting it fails at runtime, with an error that names the call.
- `askdb --help` and every command other than Prisma introspection resolve no `@askdb/prisma` or `@prisma/*` module (`apps/cli/src/load-cost.test.ts`). `askdb introspect templates` names only the engines already loaded when it lists the ones with templates.
- Node 24 and later can keep a failed package lookup until the process exits, so a long-running host can't always load an optional package installed after its first attempt. The kit's loader then says to restart the process rather than to install the package, and Studio's guided setup checks for packages on disk, not through Node's resolver, before it installs them.
- Prisma users install `@askdb/prisma` themselves, and on pnpm 11 approve the `@prisma/engines` build. `askdb init --database prisma` and Studio's guided setup do both.

## Out of scope

- Moving dialect specs back out of `@askdb/core`. Decided 2026-11-05 by [ADR 0029](0029-core-owns-built-in-dialect-specs.md): core owns the built-in dialect specs.
- Auto-registration or dynamic discovery of third-party adapters by the shipped `askdb` binary. Loading an adapter the host registered, on first use, is in scope since the 2026-11-05 amendment.
- Removing `@askdb/connectors` (a future major can drop the shim).

## Related

- [ADR 0002 — Integration-package layout](0002-integration-package-layout.md)
- [ADR 0006 — AI provider integration strategy](0006-ai-provider-integration-strategy.md)
- [ADR 0007 — Connector provider registry](0007-connector-registry.md)
- `packages/introspect/src/registry.ts`: the registry and adapter contract.
- `packages/introspect/src/kit/`: the engine kit.
- [Connector authoring](../integration/connectors.md)
