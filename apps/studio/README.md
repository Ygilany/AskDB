# @askdb/studio

Local React browser UI for editing AskDB Schema v2 enrichment, checking RAG
retrieval, and generating sample NL-to-SQL output.

```sh
askdb-studio --schema ./my-app.schema
# or through the main CLI
askdb studio --schema ./my-app.schema
```

Studio serves a local web app at `http://127.0.0.1:5556` by default. The
published package contains a Node local server plus a Vite-built React client.
It can:

- browse all physical tables and columns in `schema.json`
- edit table descriptions, aliases, primary entities, tags, common query language, example questions, and column metadata
- write the describable layer back to `tables/*.md`
- request AI enrichment suggestions when `OPENAI_API_KEY` is configured
- build and query the configured RAG index (`memory`, file-backed, or `pgvector`)
- generate sample Postgres SQL for natural-language questions against the currently saved enrichment
- define and manage multi-tenancy policy (tenant roots, hierarchy, scoped/polymorphic/global tables) via the Tenancy view
- draft tenant policy with AI assistance
- test NL→SQL with tenant scope controls and SQL output modes (`sql-only` vs `sql-params`)

Schema browsing, enrichment, and SQL generation do not require a database
driver. The optional Playground execute path, which runs generated SQL against
Postgres, requires `pg` in the project running Studio:

```sh
pnpm add pg
```

Studio uses `@askdb/enrich` for the shared non-UI Schema v2 authoring logic:
workspace loading, editable drafts, markdown/frontmatter preservation, save
helpers, and suggestion context. It should not depend on `@askdb/tui`, which is
the separate terminal authoring surface.

## Development

```sh
pnpm --filter @askdb/studio build
pnpm --filter @askdb/studio test
pnpm --filter @askdb/studio start -- --schema ../../fixtures/schemas/orders-users.schema
```

The client source lives in `src/web/` and builds to `dist/client/`. The server
source lives in `src/` and serves the compiled client assets from that directory.

The React client is styled with Tailwind CSS and shadcn-style primitives. The
requested shadcn preset is recorded in `components.json`:

```sh
pnpm dlx shadcn@latest init --preset b1D0eCA4
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables AI suggestions and sample NL-to-SQL generation. |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible base URL. |
| `ASKDB_STUDIO_HOST` | Bind host. Defaults to `127.0.0.1`. |
| `ASKDB_STUDIO_PORT` | Bind port. Defaults to `5556`. |
| `ASKDB_MOCK_SQL` | Deterministic generated SQL for tests or offline demos. |
| `ASKDB_RAG_EMBEDDER` | Set to `mock`, `openai`, or `ai-sdk` for Studio RAG indexing. Defaults to the mock lexical embedder unless an AI key is configured. |
| `ASKDB_RAG_EMBEDDER_MODEL` | Embedding model override for Studio RAG. |
| `ASKDB_RAG_EMBEDDER_DIMENSIONS` | Optional embedding dimension override. |

Studio uses the active `rag.store` branch from `askdb.config.*`. For `pgvector`,
make sure the configured table/extension already exist and `ASKDB_PGVECTOR_URL`
resolves correctly.
