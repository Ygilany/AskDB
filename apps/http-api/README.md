# @askdb/http-api

Minimal HTTP surface that wraps [`@askdb/core`](https://www.npmjs.com/package/@askdb/core) — no duplicated NL→SQL logic. `POST /ask` returns checked SQL only.

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

Point the server at a schema with `--schema-path` or `host.schemaPath` in `askdb.config.ts`. The binary loads `askdb.config.*` / `.config/askdb.*` from the current working directory via [`@askdb/config`](https://www.npmjs.com/package/@askdb/config) after loading the working directory's `.env`. Only when run from AskDB's own repository does it fall back to `apps/http-api/.env` and then the repository root's; an install never reads a `.env` inside `node_modules`. Shell / `.env` variables only take effect when the config maps them with `env(...)`:

```ts
// askdb.config.ts
host: { schemaPath: env("SCHEMA_PATH") },
```

```bash
node apps/http-api/dist/bin.js --schema-path fixtures/schemas/orders-users.schema
```

Health check:

```bash
curl -sS http://127.0.0.1:3000/health
```

## Embed in your own process

```ts
import { createAskDbHttpServer } from "@askdb/http-api";

const server = createAskDbHttpServer({ port: 3000 });
await server.listen();
```

`createAskDbHttpServer()` uses the config your process already loaded with `bootstrapAskDbEnv()` from `@askdb/config`. If there is none, it loads `.env` and `askdb.config.*` from the working directory, and throws when it finds no config. Omitted `port` and `host` options fall back to `httpApi.listen.*`. See the [HTTP API reference](https://askdb.tools/reference/http-api/).

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
- **Mode**: optional `x-askdb-mode` header (body `mode` wins if present). A request mode can only tighten config `modes.askdbMode` (default `schema_only`), never loosen it.
- **Execution**: not supported. Retired execution controls return `400`; review generated SQL and run any approved query outside AskDB under your own database roles, read-only controls, tenant policy, and audit logging.
- **Generation config**: set `ai.provider` / `ai.providerConfig` in `askdb.config.ts` (for tests/dev, set `dev.mockSql` to bypass live model calls). The server reads no setting from the shell on its own; to set this one from a variable, map it in the config, such as `dev: { mockSql: env("MOCK_SQL") }`.
- **Schema config (recommended)**: set `host.schemaPath` in `askdb.config.ts` (or pass `--schema-path`) to an AskDB Schema v2 directory, bundled JSON file, or `schema.json`. Per-request `schemaJson` overrides are rejected with `403 schema_override_disabled` unless you set `httpApi.allowSchemaOverride: true`. An override gets SQL for its own recorded `provider`, not for the config's `dialect`.
- **Timeouts**: the model call is aborted after `httpApi.requestTimeoutMs` (default `60000`, at most `2147483647`) and the request returns `502 sql_generation_error`.
- **Errors**: status codes come from the error type. Model-provider failures return a generic `502`, and unexpected failures return a generic `500`. Every non-`2xx` `POST /ask` response is logged as `askdb.run.error` under the response's `correlationId`, with the full error for failures inside `ask()`, except last-resort `500`s (an error that escapes the handler), which are written to stderr.

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
