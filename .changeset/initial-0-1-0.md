---
"@askdb/core": minor
"askdb": minor
"@askdb/http-api": minor
---

First public pre-1.0 release.

`@askdb/core` ships the NL→SQL pipeline (`ask`), the BYO executor seam
(`AskDbExecutor`, `TabularResult`), and the validated read-only PostgreSQL
guardrail. `pg` is an **optional peer dependency** — consumers using a custom
`executor` never need to install it. The built-in helpers live behind the
`@askdb/core/postgres` subpath and lazy-load `pg` on first invocation, with a
helpful error if the peer is missing.

`askdb` (npm package; `askdb` binary) and `@askdb/http-api` (`askdb-http` binary,
`POST /ask`) are thin wrappers over `@askdb/core` and ship together at the
same version.

This is the first version published to npm; semver applies to
`packages/*/src/index.ts` exports and `docs/contracts/` going forward.
