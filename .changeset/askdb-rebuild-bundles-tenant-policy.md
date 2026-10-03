---
"askdb": patch
---

`askdb bundle` now includes `tenant-policy.md` in the bundle (via `@askdb/enrich`). Bundles built with `askdb` 1.0.0-beta.42 or earlier left the tenant policy out, so a multi-tenant schema loaded from one of them came up with no policy, and `ask()` neither required a `tenantScope` nor injected tenant predicates. Rebuild every bundle made from a schema directory that has a `tenant-policy.md`, then check that `loadSchema(bundlePath).tenantPolicy` is defined.
