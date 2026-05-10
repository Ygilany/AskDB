---
"@askdb/introspect": minor
---

New workspace package: `@askdb/introspect` — schema introspection on the
connector pattern. Phase 6 ships a Postgres connector, deterministic catalog
SQL templates, live mode through the `AskDbExecutor` seam, air-gapped CSV/JSON
export bundle ingestion, Schema v2 rendering, ID-anchored re-introspection
merge, and the `askdb-introspect` CLI (`--url`, `--from-export`, `--out`,
`--print`, `--diff`, and `templates`).

The public surface includes `introspect()`, `renderToSchemaV2()`,
`toV2SchemaJson()`, connector/types exports from `@askdb/introspect`, and the
Postgres sub-export at `@askdb/introspect/postgres`.
