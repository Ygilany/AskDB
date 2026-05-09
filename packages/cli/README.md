# @askdb/cli

Command-line frontend for [`@askdb/core`](https://www.npmjs.com/package/@askdb/core). Ask natural-language questions, get a validated read-only PostgreSQL `SELECT`, and (optionally) execute it.

> **Status:** pre-1.0.

## Install

```bash
pnpm add -g @askdb/cli
# or run without installing:
pnpm dlx @askdb/cli --help
```

The CLI ships with `pg` so the built-in Postgres executor works out of the box.

## Quickstart

```bash
export OPENAI_API_KEY=sk-...
export ASKDB_SCHEMA_PATH=./schema.json
askdb "How many users signed up last week?"
```

To execute the generated SQL against a database:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/db
askdb --execute "Top 5 customers by lifetime value"
```

## Common flags

- `--schema <path>` — AskDB schema JSON v1 file (overrides `ASKDB_SCHEMA_PATH`).
- `--execute` — run the generated SELECT in a read-only transaction.
- `--mode <mode>` — one of the supported modes (see `docs/contracts/modes-v1.md`).
- `--explain` — emit heuristic guardrail metadata alongside the SQL.
- `--log-level <level>` — Pino log level (silent, error, warn, info, debug, trace).

Run `askdb --help` for the full list.

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Default LanguageModel provider key. |
| `ASKDB_SCHEMA_PATH` | Default schema file. |
| `DATABASE_URL` | Postgres connection string for `--execute`. |
| `ASKDB_MOCK_SQL` | Bypass live model calls in tests/dev. |

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
