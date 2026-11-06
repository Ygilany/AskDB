---
"@askdb/docs-site": patch
---

The core API reference says which dialect rules a rebind uses, and lists `BindGuardrails.dialect`, `dialectRules`, and the `DIALECT_SPEC_REQUIRED` and `DIALECT_UNSUPPORTED` errors. The client API reference lists `askdb.bind()`'s `dialect`. Safety boundaries says to pass a host's `DialectSpec` at rebind too. Troubleshooting explains `DIALECT_SPEC_REQUIRED`, including an app that loads two copies of `@askdb/core`, and the beta.46 upgrade notes say what to change (#660).
