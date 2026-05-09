# @askdb/http-api

Minimal HTTP surface that wraps [`@askdb/core`](https://www.npmjs.com/package/@askdb/core) — no duplicated NL→SQL logic. `POST /ask` returns a validated read-only `SELECT` (with optional execution behind a server-side feature flag).

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
pnpm -C packages/http-api build
node packages/http-api/dist/bin.js
```

Dev watch (runs with `packages/http-api` as the working directory):

```bash
pnpm -C packages/http-api dev:watch
```

Set `ASKDB_SCHEMA_PATH` in the repo-root `.env` (recommended):

```bash
# in ../../.env (repo root):
# ASKDB_SCHEMA_PATH=fixtures/schemas/orders-users.schema.json
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
- **Execution**: disabled by default. Requests that set `execute: true` (or `x-askdb-execute: true`) get **403** unless `ASKDB_HTTP_ENABLE_EXECUTION=true` is set on the server.
- **Generation config**: set `OPENAI_API_KEY` (or for tests/dev, set `ASKDB_MOCK_SQL` to bypass live model calls).
- **Schema config (recommended)**: set `ASKDB_SCHEMA_PATH` to an AskDB schema JSON v1 file. You *can* also send `schemaJson` per request as an override, but it doesn’t scale.

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
