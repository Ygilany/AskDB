# `@askdb/introspect`

Engine-agnostic introspection orchestrator for AskDB. Defines the `Connector` contract and turns the integration package's `SqlSchema` output into a Schema v2 directory.

> Status: pre-1.0. `@askdb/introspect` itself does not bundle any engine support — integration packages (e.g. `@askdb/postgres`, `@askdb/prisma`) supply connectors and input shapes.

## Install

```bash
pnpm add @askdb/introspect @askdb/core
# Plus an integration package for the engine you're targeting, e.g.:
pnpm add @askdb/postgres pg
# Or for Prisma schema-file introspection:
pnpm add @askdb/prisma
```

## Programmatic usage

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresCatalogQueryRunner, createPostgresConnector } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", runner: createPostgresCatalogQueryRunner(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPostgresConnector() },
);
```

The output directory contains a physical Schema v2 artifact (`schema.json`) plus the Phase 5 describable layer.

For Prisma projects, use `@askdb/prisma` to read schema files without connecting to the database:

```ts
import { introspect } from "@askdb/introspect";
import { createPrismaConnector } from "@askdb/prisma";

const result = await introspect(
  { schemaPath: "./prisma", schemaId: "my-app" },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPrismaConnector() },
);
```

To get the exact `schema.json` bytes without writing anything (for previews or drift checks), use `renderSchemaV2Body(result.schema, { schemaId, provider: result.provider, existingArtifactDir })`. It is the same function `renderToSchemaV2` writes through — including the merge that carries human-set `sensitive` flags over from an existing artifact — and it backs `askdb introspect --out`, `--print`, and `--diff`.

## CLI

The user-facing CLI for introspection ships in the [`askdb`](https://www.npmjs.com/package/askdb) package as `askdb introspect`. `@askdb/introspect` does not provide a standalone binary.

## Implementing a new connector

A `Connector<TInput>` has two methods:

- `describe(input: TInput): Promise<IntrospectionResult>` — the integration's input shape goes through unchanged.
- `templates?(): SqlTemplateBundle` — optional; only relevant for engines that introspect via catalog SQL.

The integration package owns its own input type (e.g. `PostgresIntrospectionInput`, `PrismaIntrospectionInput`). `@askdb/introspect` does not assume a live catalog runner exists, a bundle path exists, a schema-file path exists, or a template suite exists.

### Engine kit (`@askdb/introspect/kit`)

The `@askdb/introspect/kit` subpath holds the engine-agnostic helpers every first-party engine package uses, so a new engine does not copy them:

| Helper | Purpose |
| --- | --- |
| `createOptionalDriverLoader({ packageName, specifier?, importDriver, missingMessage })`, `isDriverInstalled(packageName, { resolveFrom? })`, `missingDriverMessage({ engine, packageName })` | Lazy, cached loading of an optional driver peer (`pg`, `mysql2`, …): the engine package's own `import()` first, then the caller's project (`resolveFrom`, default `process.cwd()`). A missing peer rejects with an `AskDbError`; the failed cache slot is cleared so a later call retries. |
| `compileTableFilters(patterns)`, `ambiguousFilterWarnings(patterns, qualifiedNames)` | `IntrospectionFilters.tables` glob matching (`*`, `?`) and the `ambiguous_filter` warning for patterns that match nothing. |
| `makeTableId(schema, table)`, `makeColumnId(schema, table, column)` | Schema v2 ids (`table:<schema>.<name>`, `table:<schema>.<name>#<column>`). |
| `rowsToRecords(result, { expectedColumns?, source? })`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction` | Folding positional `CatalogQueryResult` rows into Schema v2 tables, constraints, and indexes. |
| `redactUrlUserinfo`, `redactSecretKeyValues`, `redactConnectionStringGeneric`, `hasUrlScheme`, `isSecretConnectionKey`, `REDACTED_SECRET` | Building blocks for an engine's `redactConnectionString()`. |

```ts
import { createOptionalDriverLoader, missingDriverMessage } from "@askdb/introspect/kit";

const driver = createOptionalDriverLoader<typeof import("my-driver")>({
  packageName: "my-driver",
  // Keep the import literal in *your* package, where the peer is declared.
  importDriver: () => import("my-driver"),
  missingMessage: missingDriverMessage({ engine: "MyEngine", packageName: "my-driver" }),
});
```

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
