---
"@askdb/introspect": patch
"@askdb/prisma": patch
---

Apply the test campaign's plan for `@askdb/introspect` and `@askdb/prisma`: two weak tests can now fail for the regression they name, eight redundant tests fold into the tests that own their contract, and `isModuleResolutionFailure` is no longer exported from the kit's driver module (it was never reachable through the package `exports` map). No behavior or public API change.
