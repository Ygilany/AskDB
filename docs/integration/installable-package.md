# AskDB as an installable package — BYO model + SQL output

AskDB ships four library packages:

1. [`@askdb/core`](../../packages/core/README.md) — dialect-agnostic NL→SQL pipeline (`ask()`, schema/IR types, modes, logging, retrieval input).
2. [`@askdb/introspect`](../../packages/introspect/README.md) — engine-agnostic introspection orchestrator, `CatalogQueryRunner` type, and Schema v2 renderer.
3. [`@askdb/postgres`](../../packages/postgres/README.md) — Postgres integration: dialect adapter (`postgresDialect`), connector (live + from-export), catalog templates, and a `pg`-backed catalog query runner for live introspection.
4. [`@askdb/prisma`](../../packages/prisma/README.md) — Prisma integration: schema-file connector that renders Schema v2 from `.prisma` files without a database connection.

The supported user-facing CLI is [`@askdb/cli`](../../apps/cli/README.md) (`askdb` binary, `npm i -g @askdb/cli`). `@askdb/http-api`, `@askdb/tui`, and `@askdb/docs-site` are first-party reference apps.

Architecture rationale: [**ADR 0002 — Integration-package layout**](../adrs/0002-integration-package-layout.md).

---

## Install

```bash
pnpm add @askdb/core @askdb/postgres
# Optional: introspection
pnpm add @askdb/introspect
# Optional: Prisma schema-file introspection
pnpm add @askdb/prisma
# Optional: live Postgres introspection
pnpm add pg
```

`pg` is an **optional peer dependency** of `@askdb/postgres`. You do not need it when you only use `@askdb/core` to generate SQL.

---

## Minimal pipeline

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: /* your LanguageModel */,
  dialect: postgresDialect,
});
```

`loadSchema` autodetects between a v2 directory, a bundled JSON file, and a direct `schema.json` path. For inline JSON (e.g. from an env var), use `loadSchemaFromJson(raw)` instead.

### Schema v2 directory layout

```text
my-app.schema/
  schema.json        # physical layer — tables, columns, types, FKs, sensitive flags
  tables/
    users.md         # describable layer — descriptions, aliases, common query language
    orders.md
  concepts.md        # optional — cross-table domain vocabulary
```

A directory with only `schema.json` (no `tables/*.md`) is valid — tables fall back to bare names + types. See [`docs/contracts/schema-v2.md`](../contracts/schema-v2.md) for the full format contract.

---

## Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresCatalogQueryRunner, createPostgresConnector } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", runner: createPostgresCatalogQueryRunner(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPostgresConnector() },
);
```

The connector input shape (`PostgresIntrospectionInput`) is owned by `@askdb/postgres`. `@askdb/introspect` is engine-agnostic and does not know about live vs. from-export modes — each integration package defines its own input type.

For air-gapped operation, pass `{ mode: "from-export", bundlePath }` with a directory of CSV/JSON files exported by running the templates from `POSTGRES_TEMPLATE_BUNDLE` in your sealed environment.

For Prisma schema-file introspection:

```ts
import { introspect } from "@askdb/introspect";
import { createPrismaConnector } from "@askdb/prisma";

const result = await introspect(
  { schemaPath: "./prisma", schemaId: "my-app" },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPrismaConnector() },
);
```

`@askdb/prisma` reads a `schema.prisma` file or a directory of `.prisma` files. It supports relational Prisma providers and rejects MongoDB schemas because AskDB Schema v2 is relational.

---

## Breaking change

Generated-SQL execution is no longer part of the AskDB package API:

- `@askdb/core` returns `{ sql, explain? }` from `ask()`.
- `AskDbExecutor`, `TabularResult`, `execute`, and `result` are removed from core.
- `@askdb/postgres` no longer exports `createPostgresExecutor` or `executeReadOnlySelect`.
- Live introspection uses `CatalogQueryRunner` via `createPostgresCatalogQueryRunner`.
- CLI and HTTP surfaces return SQL only; applications run any approved SQL outside AskDB.
