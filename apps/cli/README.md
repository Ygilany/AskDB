# @askdb/cli

Command-line frontend for [`@askdb/core`](https://www.npmjs.com/package/@askdb/core). Ask natural-language questions and get validated SQL from the configured dialect.

> **Status:** pre-1.0.

## Install

```bash
pnpm add -g @askdb/cli
# or run without installing:
pnpm dlx @askdb/cli --help
```

The CLI delegates live introspection to AskDB connector packages; each connector owns any database driver it needs.

## Quickstart

```bash
export OPENAI_API_KEY=sk-...
askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many users signed up last week?"
```

AskDB returns SQL for review. Run approved SQL outside AskDB under your own database roles, tenant policy, and audit logging.

## Common flags

- `--schema <path>` — AskDB Schema v2 directory, bundled JSON, or schema JSON file.
- `--mode <mode>` — one of the supported modes (see `docs/contracts/modes-v1.md`).
- `--explain` — emit heuristic guardrail metadata alongside the SQL.
- `--log-level <level>` — Pino log level (silent, error, warn, info, debug, trace).

Run `askdb --help` for the full list.

## Init

```bash
askdb init
# writes ./askdb.config.ts only (refuses to overwrite unless --force)
```

Use `--path` to write the template to a different file. Example `.env` keys and notes live in **comments** inside `askdb.config.ts`; create your own `.env` if you use `env("...")` with `dotenv`.

## Enrichment UIs

```bash
askdb enrich --schema my-app.schema
askdb studio --schema my-app.schema
```

`askdb enrich` opens the terminal UI. `askdb studio` starts a local browser UI for browsing tables, editing Schema v2 enrichment, requesting AI suggestions, and generating sample NL-to-SQL output before shipping the schema.

## Introspection

Postgres live and air-gapped introspection:

```bash
askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb introspect --from-export ./pg-export-bundle --out my-app.schema --schema-id my-app
```

Prisma schema-file introspection does not connect to the database:

```bash
askdb introspect --engine prisma --prisma-schema ./prisma --out my-app.schema
askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma --print
askdb introspect --engine prisma --prisma-schema ./prisma --diff my-app.schema
```

## Environment

The CLI loads `.env` from the current working directory (via dotenv), then evaluates an optional AskDB config file (`askdb.config.*` or `.config/askdb.*`) via [`@askdb/config`](https://www.npmjs.com/package/@askdb/config) (`bootstrapAskDbEnv`), which installs the **runtime snapshot** used by `getAskDbRuntimeConfig()` — AskDB does **not** copy the full flattened map into `process.env`. Run `askdb init` to create **`askdb.config.ts`** with nested `defineConfig` and `env()` examples; optional `.env` guidance is in comments in that file (no `.env` is generated).

`askdb init` **skips** loading config so a broken template never blocks scaffolding.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Default LanguageModel provider key (often set via `askdb.config.ts`). |
| `ASKDB_SCHEMA_PATH` | Default schema file. |
| `DATABASE_URL` | Postgres connection string for `askdb introspect --url`. |
| `ASKDB_MOCK_SQL` | Bypass live model calls in tests/dev. |

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
