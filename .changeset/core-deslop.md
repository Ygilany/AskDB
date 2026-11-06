---
"@askdb/core": patch
---

`@askdb/core` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: schema loading, prompt text, tenant-scope validation and parameter-manifest checks give the same results and errors as before. The doc comments on the `sensitive` flag of `NormalizedSchema` tables and columns now match the default: a sensitive identifier is listed in the prompt tagged `(sensitive)`, and withheld only when prompt omission is on.
