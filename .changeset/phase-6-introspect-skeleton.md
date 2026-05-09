---
"@askdb/introspect": minor
---

New workspace package: `@askdb/introspect` — schema introspection on the
connector pattern. Phase 6 milestone 1 ships only the package skeleton and
the public type surface (`SqlSchema`, `Connector`, `IntrospectionInput`,
`IntrospectionResult`, `IntrospectionWarning`, `SqlTemplateBundle`,
`RenderOptions`) plus stubbed `introspect()`, `renderToSchemaV2()`, and a
postgres sub-export at `@askdb/introspect/postgres`. Catalog SQL, live mode,
air-gapped bundle ingestion, ID-anchored re-introspection merge, and the
`askdb-introspect` CLI surface arrive in milestones 2–7.
