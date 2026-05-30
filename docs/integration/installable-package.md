# AskDB as an installable package — BYO model + SQL output

AskDB ships focused library packages:

1. [`@askdb/core`](../../packages/core/README.md) — dialect-agnostic NL→SQL pipeline (`ask()`, schema/IR types, modes, logging, retrieval input).
2. [`@askdb/introspect`](../../packages/introspect/README.md) — engine-agnostic introspection orchestrator, `CatalogQueryRunner` type, and Schema v2 renderer.
3. [`@askdb/postgres`](../../packages/postgres/README.md) — Postgres integration: dialect adapter (`postgresDialect`), connector (live + from-export), catalog templates, and a `pg`-backed catalog query runner for live introspection.
4. [`@askdb/prisma`](../../packages/prisma/README.md) — Prisma integration: schema-file connector that renders Schema v2 from `.prisma` files without a database connection.
5. [`@askdb/enrich`](../../packages/enrich/README.md) — headless Schema v2 enrichment workspace helpers used by TUI, Studio, and custom authoring surfaces.
6. [`@askdb/config`](../../packages/config/README.md) — Prisma-style `askdb.config.*` / `.config/askdb.*` discovery and `bootstrapAskDbEnv()`. **This is the only package that reads `process.env` directly.** All other packages use **`getAskDbRuntimeConfig()`** from here (not raw `process.env`).
7. [`@askdb/ai`](../../packages/ai/README.md) — optional config/env-to-model helpers for AI SDK providers.

The supported user-facing CLI is the [`askdb`](../../apps/cli/README.md) package (`askdb` binary, `npm i -g askdb`). `@askdb/http-api`, `@askdb/tui`, `@askdb/studio`, and `@askdb/docs-site` are first-party reference apps.

Architecture rationale: [**ADR 0002 — Integration-package layout**](../adrs/0002-integration-package-layout.md).

Configuration bootstrap: [**ADR 0005 — AskDB config package and env bootstrap**](../adrs/0005-askdb-config-and-env-bootstrap.md).

Enrichment package boundary: [**ADR 0004 — Enrichment-package boundary**](../adrs/0004-enrichment-package-boundary.md).

Authoring a new integration: [**Connectors — what each connector needs**](connectors.md).

---

## Install

```bash
pnpm add @askdb/core @askdb/postgres
# Example model provider; use any AI SDK-compatible provider you prefer
pnpm add ai @ai-sdk/openai
# Optional: introspection
pnpm add @askdb/introspect
# Optional: build a custom Schema v2 enrichment authoring surface
pnpm add @askdb/enrich
# Optional: Prisma schema-file introspection
pnpm add @askdb/prisma
# Optional: Prisma-style env mapping + askdb.config discovery (used by the CLI; optional for library hosts)
pnpm add @askdb/config
# Optional: AskDB config/env model factory
pnpm add @askdb/ai
# Optional: live Postgres introspection
pnpm add pg
```

`pg` is an **optional peer dependency** of `@askdb/postgres`. You do not need it when you only use `@askdb/core` to generate SQL.

[`@askdb/config`](../../packages/config/README.md) is the **only** package that reads `process.env` directly. Library packages (`@askdb/rag`, `@askdb/tui`, …) depend on `@askdb/config` and use **`getAskDbRuntimeConfig()`**. Pass `config.ai.aiEnv` into `@askdb/ai` when you want AskDB's env/config model factory. Call `bootstrapAskDbEnv({ cwd: process.cwd() })` at start-up when you want the same `.env` + `askdb.config.*` behavior as the first-party CLI and HTTP API. `env()` is reserved for use **inside** `askdb.config.*` files.

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

## Enrichment authoring

`@askdb/enrich` is the shared headless package for authoring the Schema v2 describable layer. It does not render a terminal or browser UI; it provides the workspace operations both first-party authoring surfaces use:

- load a Schema v2 directory as an editable workspace
- build table drafts from physical tables plus parsed markdown
- write `tables/*.md` and `concepts.md`
- preserve recognized markdown sections during scoped edits
- validate concept links against physical table/column ids
- build AI suggestion targets and context
- bundle a split Schema v2 directory into a single JSON artifact

Use `@askdb/tui` or `askdb enrich` when you want the maintained terminal authoring flow. Use `@askdb/studio` when you want the maintained local browser authoring flow. Use `@askdb/enrich` directly when building another authoring UI.

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
