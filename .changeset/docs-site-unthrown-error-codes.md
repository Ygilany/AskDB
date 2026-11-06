---
"@askdb/docs-site": patch
---

The `@askdb/core` reference drops the four removed error codes and documents `GLOBAL_WITHOUT_REASON`, and the upgrade guide's 1.0.0-beta.46 section says what to change (#682). The docs-site `test:errors` check now also fails when a page's Errors tables list a class or code that `errors.ts` no longer declares.
