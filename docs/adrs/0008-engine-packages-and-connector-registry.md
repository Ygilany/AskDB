# ADR 0008 — Engine packages, the shared engine kit, and the connector registry in `@askdb/introspect`

## Status

Accepted (2026-09-25).

Supersedes in part:
- [ADR 0002](0002-integration-package-layout.md): the rule that integration packages own their SQL dialect.
- [ADR 0007](0007-connector-registry.md): where the connector registry lives, and its closed provider union.

## Context

ADR 0002 organized AskDB around one package per integration. Each integration owned its dialect, connector, input shape, and catalog runner. ADR 0007 added `@askdb/connectors` as a registry so apps could dispatch on a config-selected engine without a hand-written switch. Since then, three things have changed.

1. **Dialects moved to core.** The dialect specs now live in `@askdb/core` (`packages/core/src/sql/dialect-spec.ts`): `POSTGRES_DIALECT`, `MYSQL_DIALECT`, `SQLITE_DIALECT`, `SQLSERVER_DIALECT`, and the rest. `ask()` takes a dialect id, and engine packages only re-export their spec. What an engine package owns today is introspection: catalog SQL, row shapes, the optional driver peer, connection-string formats, and connection resolution.
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
   - `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage`
   - `compileTableFilters` / `ambiguousFilterWarnings`
   - `makeTableId` / `makeColumnId`
   - `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`
   - the connection-string redaction helpers
   - `defineLiveConnectorProvider`, the adapter for engines that introspect only through a live `CatalogQueryRunner`

   Every first-party engine is built on the kit.
3. **Move the connector registry into `@askdb/introspect` and open its provider ids.**
   - `createConnectorRegistry`, `ConnectorProviderAdapter`, `ConnectorConfig`, and `ConnectorRegistry` are exported from `@askdb/introspect`.
   - The provider id is typed `ConnectorProviderId = BuiltInConnectorProvider | (string & {})`. Any string is valid, and the built-in ids still autocomplete.
   - Unregistered built-in ids still get an `Install @askdb/<id>` hint.
4. **Adapters own connection resolution and redaction.** `ConnectorProviderAdapter` gains two optional hooks:
   - `resolveConnection({ explicit?, runtime, surface? })`. It turns explicit values (CLI flags) plus AskDB runtime config (`getAskDbRuntimeConfig()`, typed structurally so engines do not depend on `@askdb/config`) into `{ url?, fromExport?, schemaPath? }` and a credential-free `sourceLabel`, or an error. `surface: "cli"` makes error messages name flags; other surfaces name config keys.
   - `redactConnectionString(input)`.

   The registry exposes both as `registry.resolveConnection(provider, request)` and `registry.redactConnectionString(provider, input)`. When an adapter has no hook, the registry falls back to passing `explicit` through and to `redactConnectionStringGeneric`. The CLI and Studio switches are deleted. Both apps now dispatch through the registry, and the CLI accepts an injected registry (`runIntrospectCli(argv, { connectorRegistry })`).
5. **Deprecate `@askdb/connectors`.** It stays published as a re-export shim of the registry and the kit's redaction helpers. `CONNECTOR_PROVIDERS` is kept as an alias of `BUILT_IN_CONNECTOR_PROVIDERS`, and `ConnectorProvider` as an alias of `ConnectorProviderId`. Engine packages and first-party apps no longer depend on it.

## Rationale

- **The registry belongs next to the contract it dispatches.** `Connector<TInput>` and `introspect()` are in `@askdb/introspect`, and so is the registry now. A separate package bought a second install and a second version to keep in step, and it hid nothing, because every engine already depends on `@askdb/introspect`.
- **Open ids are what ADR 0002 promised.** With `(string & {})`, a third-party `@acme/askdb-oracle` package registers `provider: "oracle"` without any AskDB change, and editors still suggest the built-in ids.
- **Connection resolution is engine knowledge.** Which config value is the connection, whether `--from-export` applies, and how a DSN is redacted are all engine-specific facts. They belong in the engine package, the same way catalog SQL does. The apps keep only engine-agnostic rules, such as `--url` and `--from-export` being mutually exclusive, output modes, and logging.
- **A kit, not a base class.** The kit is a set of plain functions. Engines take what they need, and nothing constrains their catalog SQL or input shapes.

## Consequences

- About 600 lines leave the engine packages. A new engine gets driver loading, filters, ids, row folding, redaction, and, for live-only engines, a full `ConnectorProviderAdapter` from the kit.
- A third-party engine plugs into any registry-driven host, programmatic or custom, without AskDB changes. The CLI's introspect command is written against an injected registry: `runIntrospectCli(argv, { connectorRegistry })` is internal and covered by a test that uses a custom adapter. So it contains no engine-specific code. The shipped `askdb` binary still registers only the first-party engines. There is no auto-discovery; see "Out of scope".
- The CLI and Studio keep their user-facing error messages. The only visible change: `askdb introspect templates --engine prisma` now reports the generic "does not provide SQL templates" message instead of a Prisma-specific one.
- `@askdb/config`'s `introspection.provider` is still a closed union in the typed config. Opening the typed config to third-party engines is separate work. A third-party adapter can already read its own values from `runtime.structured` or `runtime.flat`.
- `@askdb/connectors` consumers keep working. The `ConnectorProvider` type widening from a closed union to an open string is the one type-level change, and it is released as a minor.

## Out of scope

- Moving dialect specs back out of `@askdb/core`.
- Auto-registration or dynamic discovery of third-party adapters by the shipped `askdb` binary.
- Removing `@askdb/connectors` (a future major can drop the shim).

## Related

- [ADR 0002 — Integration-package layout](0002-integration-package-layout.md)
- [ADR 0006 — AI provider integration strategy](0006-ai-provider-integration-strategy.md)
- [ADR 0007 — Connector provider registry](0007-connector-registry.md)
- `packages/introspect/src/registry.ts`: the registry and adapter contract.
- `packages/introspect/src/kit/`: the engine kit.
- [Connector authoring](../integration/connectors.md)
