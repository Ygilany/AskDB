# @askdb/http-api (Phase 3)

Minimal HTTP surface that wraps `@askdb/core` (no duplicated NL→SQL logic).

## Local run

From repo root:

```bash
pnpm -C packages/http-api build
node packages/http-api/dist/bin.js
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
  "question": "How many users are there?",
  "schemaJson": "{\"version\":1,\"tables\":[{\"name\":\"users\",\"columns\":[{\"name\":\"id\",\"type\":\"uuid\"}]}]}"
}
JSON
)"
```

Notes:

- **Correlation**: if you omit `x-correlation-id`, the server generates one and returns it.
- **Mode**: optional `x-askdb-mode` header (body `mode` wins if present).
- **Execution**: disabled by default. Requests that set `execute: true` (or `x-askdb-execute: true`) get **403** unless `ASKDB_HTTP_ENABLE_EXECUTION=true` is set on the server.
- **Generation config**: set `OPENAI_API_KEY` (or for tests/dev, set `ASKDB_MOCK_SQL` to bypass live model calls).

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
    schemaJson: JSON.stringify({
      version: 1,
      tables: [{ name: "users", columns: [{ name: "id", type: "uuid" }] }],
    }),
  }),
});

console.log(await res.json());
```

