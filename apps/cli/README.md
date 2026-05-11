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
export ASKDB_SCHEMA_PATH=./schema.json
askdb ask --schema "$ASKDB_SCHEMA_PATH" --question "How many users signed up last week?"
```

## Common flags

- `--schema <path>` — AskDB Schema v2 directory, bundled JSON, or schema JSON file.
- `--mode <mode>` — one of the supported modes (see `docs/contracts/modes-v1.md`).
- `--explain` — emit heuristic guardrail metadata alongside the SQL.
- `--log-level <level>` — Pino log level (silent, error, warn, info, debug, trace).

Run `askdb --help` for the full list.

## Introspection

Postgres live and air-gapped introspection:

```bash
askdb introspect --url "$DATABASE_URL" --out my-app.schema
askdb introspect --from-export ./pg-export-bundle --out my-app.schema
```

Prisma schema-file introspection does not connect to the database:

```bash
askdb introspect --engine prisma --prisma-schema ./prisma --out my-app.schema
askdb introspect --engine prisma --prisma-schema ./prisma/schema.prisma --print
askdb introspect --engine prisma --prisma-schema ./prisma --diff my-app.schema
```

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Default LanguageModel provider key. |
| `ASKDB_SCHEMA_PATH` | Default schema file. |
| `DATABASE_URL` | Postgres connection string for `askdb introspect --url`. |
| `ASKDB_MOCK_SQL` | Bypass live model calls in tests/dev. |

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
