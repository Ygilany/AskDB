---
"@askdb/studio": minor
"@askdb/core": minor
---

Add AI-drafted tenant policy creation flow: new `POST /api/suggest-tenant-policy` endpoint analyzes schema DDL and proposes a complete tenant policy for user review; manual configuration fallback with table/column dropdowns; editable review screen for roots, hierarchy, scoped tables, polymorphic tables, global tables, enforcement mode, and documentation body before confirming. Add `writeTenantPolicyMarkdown` to `@askdb/core` for round-trip serialization of tenant-policy.md.
