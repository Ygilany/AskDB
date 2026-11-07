---
"@askdb/config": patch
---

The doc comments on `AskDbConfig` and its blocks no longer name the internal `ASKDB_*` keys each value is copied to, such as `ASKDB_INTROSPECT_OUT` (#629): AskDB never reads those from the environment. The `rag` and `studio` blocks now say they are experimental, with a link to ADR 0030: a minor release of `@askdb/config` may change them (#662). The README no longer mentions a bootstrap-time allowlist of shell variables, which was removed.
