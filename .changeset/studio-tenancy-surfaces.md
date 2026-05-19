---
"@askdb/studio": minor
"@askdb/core": minor
---

Add multi-tenancy Studio surfaces: AI-drafted tenant policy creation flow that analyzes schema DDL and proposes a complete policy for user review; manual configuration fallback with table/column dropdowns; editable review screen for roots, hierarchy, scoped tables, polymorphic tables, global tables, enforcement mode, and documentation body. Tenancy dashboard with coverage report and policy warnings. Ask panel tenant scope controls with JSON input, SQL output mode toggle, and tenant binding display. Add `writeTenantPolicyMarkdown` to `@askdb/core` for round-trip serialization.
