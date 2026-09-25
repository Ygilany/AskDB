# @askdb/http-api

Minimal HTTP surface that wraps [`@askdb/core`](https://www.npmjs.com/package/@askdb/core) — no duplicated NL→SQL logic. `POST /ask` returns validated SQL only.

> **Status:** pre-1.0.

## Install

```bash
pnpm add -g @askdb/http-api
askdb-http
```

Or run from a clone — see "Local run" below.

## Local run

From repo root:

```bash
pnpm -C apps/http-api build
node apps/http-api/dist/bin.js
```

Dev watch (runs with `apps/http-api` as the working directory):

```bash
pnpm -C apps/http-api dev:watch
```

Point the server at a schema with `--schema-path` or `host.schemaPath` in `askdb.config.ts`. The binary loads `askdb.config.*` / `.config/askdb.*` from the current working directory via [`@askdb/config`](https://www.npmjs.com/package/@askdb/config) after resolving `.env` candidates (repo root, cwd, package dir). Shell / `.env` variables only take effect when the config maps them with `env(...)`:

```ts
// askdb.config.ts
host: { schemaPath: env("ASKDB_SCHEMA_PATH") },
```

```bash
node apps/http-api/dist/bin.js --schema-path fixtures/schemas/orders-users.schema
```

Health check:

```bash
curl -sS http://127.0.0.1:3000/health
```

## Ask (curl)

```bash
curl -sS http://127.0.0.1:3000/ask \
  -H 'content-type: application/json' \
  -H 'x-correlation-id: demo-123' \
  -d "$(cat <<'JSON'
{
  "question": "How many users are there?"
}
JSON
)"
```

Notes:

- **Correlation**: if you omit `x-correlation-id`, the server generates one and returns it.
- **Mode**: optional `x-askdb-mode` header (body `mode` wins if present).
- **Execution**: not supported. Retired execution controls return `400`; review generated SQL and run any approved query outside AskDB under your own database roles, read-only controls, tenant policy, and audit logging.
- **Generation config**: set `ai.provider` / `ai.providerConfig` in `askdb.config.ts` (for tests/dev, set `dev.mockSql` to bypass live model calls). The server does not read `ASKDB_MOCK_SQL` from the shell; map it in the config with `dev: { mockSql: env("ASKDB_MOCK_SQL") }` if you want that.
- **Schema config (recommended)**: set `host.schemaPath` in `askdb.config.ts` (or pass `--schema-path`) to an AskDB Schema v2 directory, bundled JSON file, or `schema.json`. Per-request `schemaJson` overrides are rejected with `403 schema_override_disabled` unless you set `httpApi.allowSchemaOverride: true`.
- **Timeouts**: the model call is aborted after `httpApi.requestTimeoutMs` (default `60000`) and the request returns `502 sql_generation_error`.
- **Errors**: status codes come from the error type. Model-provider failures return a generic `502`, and unexpected failures return a generic `500`. The full error is logged server-side under the response's `correlationId`.

## Ask (Node)

```js
const res = await fetch("http://127.0.0.1:3000/ask", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-correlation-id": "demo-123",
    "x-askdb-mode": "schema_only",
  },
  body: JSON.stringify({
    question: "How many users are there?",
  }),
});

console.log(await res.json());
```

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
