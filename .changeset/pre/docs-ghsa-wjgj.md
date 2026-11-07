---
"@askdb/docs-site": patch
---

Document the beta.49 security fix ([GHSA-wjgj-mf9h-6g68](https://github.com/Ygilany/AskDB/security/advisories/GHSA-wjgj-mf9h-6g68)): the upgrade guide gains a security entry, and the multi-tenancy guide and the `@askdb/core` API reference note that `ask()` re-checks the rendered SQL in `sql-only` mode and refuses a statement that reads differently with `SqlValidationError`. The beta.49 upgrade section is now marked as released.
