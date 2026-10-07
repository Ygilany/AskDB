---
---

Add `examples/express-server` — a copy-paste-ready Express HTTP server that embeds AskDB using `@askdb/client`.

Schema, model, and dialect are fully config-driven: `askdb.config.ts` sets `host.schemaPath` via `env("ASKDB_SCHEMA_PATH")`, so `server.ts` requires no per-call configuration. The `/ask` endpoint accepts an optional `execute` flag to either return just the generated SQL or also run it through a `pg.Pool` and return rows.

Also adds a "Complete example" section to the `embed-in-node` guide linking to the example package.
