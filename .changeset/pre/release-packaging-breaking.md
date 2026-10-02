---
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

Breaking (pre-1.0, so a minor bump):

- Require Node `>=22.12` consistently: `askdb`, `@askdb/http-api`, and `@askdb/studio` previously declared `>=22`, but the libraries they depend on already required `>=22.12`.
- `@askdb/http-api` and `@askdb/studio` now declare an `exports` map: `.` (the package entry) and `./package.json`. Deep imports of other files, such as `@askdb/studio/dist/server.js`, are no longer allowed; import from the package entry instead.
