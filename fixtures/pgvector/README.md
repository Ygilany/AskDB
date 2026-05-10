# pgvector Dev Fixture

Postgres with the `vector` extension installed, used for `@askdb/rag` pgvector integration tests.

```bash
# from repository root
pnpm pgvector:up

export ASKDB_PGVECTOR_URL="postgres://postgres:postgres@127.0.0.1:5434/askdb_rag"
pnpm pgvector:test

pnpm pgvector:down
```

Reset the database volume:

```bash
pnpm pgvector:reset
```

The test creates and drops its own temporary table.
