---
"@askdb/introspect": patch
---

Two JSDoc comments in `@askdb/introspect` now match the code (#712). `RenderOptions.existingArtifactDir` says the merge reads `tables/*.md` for orphan warnings, not `concepts.md`. `ConnectorConfig.schemaId` says only the Prisma adapter passes it on, and that the artifact's ID comes from `RenderOptions.schemaId`. Behavior is unchanged.
