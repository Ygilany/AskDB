# AskDB as an installable package — BYO model + BYO executor

AskDB ships three library packages:

1. [`@askdb/core`](../../packages/core/README.md) — dialect-agnostic NL→SQL pipeline (`ask()`, schema/IR types, executor seam, modes, logging).
2. [`@askdb/introspect`](../../packages/introspect/README.md) — engine-agnostic introspection orchestrator + Schema v2 renderer.
3. [`@askdb/postgres`](../../packages/postgres/README.md) — Postgres integration: dialect adapter (`postgresDialect`), connector (live + from-export), catalog templates, and the `pg`-backed executor.

The supported user-facing CLI is [`@askdb/cli`](../../apps/cli/README.md) (`askdb` binary, `npm i -g @askdb/cli`). `@askdb/http-api`, `@askdb/tui`, and `@askdb/docs-site` are first-party reference apps.

Architecture rationale: [**ADR 0002 — Integration-package layout**](../adrs/0002-integration-package-layout.md).

---

## Install

```bash
pnpm add @askdb/core @askdb/postgres
# Optional: introspection
pnpm add @askdb/introspect
# Optional: the built-in pg executor lives behind @askdb/postgres
pnpm add pg
```

`pg` is an **optional peer dependency** of `@askdb/postgres`. Skip it if you supply your own `AskDbExecutor`.

---

## Minimal pipeline

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect, createPostgresExecutor } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const { sql, result } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: /* your LanguageModel */,
  dialect: postgresDialect,
  executor: createPostgresExecutor(process.env.DATABASE_URL!),
  execute: true,
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

## BYO executor (no `pg` install)

If you supply your own `AskDbExecutor`, you do not need `pg` installed. `@askdb/postgres` only loads `pg` at the point you actually call `createPostgresExecutor(...)`.

```ts
import { ask, loadSchema, type AskDbExecutor } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./my-app.schema");

const executor: AskDbExecutor = async (sql) => {
  // Run sql in a read-only transaction with whatever driver you use
  // (postgres.js, Neon HTTP, Cloudflare Hyperdrive, MCP, ...) and return
  // rows in the canonical TabularResult shape.
  return { columns: ["x"], rows: [[1]] };
};

await ask({
  question: "anything",
  schema,
  model: /* … */,
  dialect: postgresDialect,
  executor,
  execute: true,
});
```

The executor seam contract lives at [`packages/core/src/exec/executor.ts`](../../packages/core/src/exec/executor.ts).

---

## Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresConnector, createPostgresExecutor } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", executor: createPostgresExecutor(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createPostgresConnector() },
);
```

The connector input shape (`PostgresIntrospectionInput`) is owned by `@askdb/postgres`. `@askdb/introspect` is engine-agnostic and does not know about live vs. from-export modes — each integration package defines its own input type.

For air-gapped operation, pass `{ mode: "from-export", bundlePath }` with a directory of CSV/JSON files exported by running the templates from `POSTGRES_TEMPLATE_BUNDLE` in your sealed environment.

---

## Pre-1.0 break (0.3.0)

If you are migrating from `@askdb/core@0.2.x`:

- Add `@askdb/postgres` as a dependency.
- Pass `dialect: postgresDialect` to `ask()` (now required).
- Replace `connectionString: process.env.DATABASE_URL` with `executor: createPostgresExecutor(process.env.DATABASE_URL!)`.
- Replace imports from `@askdb/core/postgres` with imports from `@askdb/postgres`.
- For introspection, replace any imports from `@askdb/introspect/postgres` or `@askdb/introspect/cli` with imports from `@askdb/postgres` (connector) or `@askdb/cli` (subcommand).
- The standalone `askdb-introspect` binary is retired; use `askdb introspect`.

See the [`Phase 7.5 changeset`](../../.changeset/phase-7-5-architecture-reshape.md) for the full breaking-change list.
