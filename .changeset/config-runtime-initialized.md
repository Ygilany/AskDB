---
"@askdb/config": minor
---

New export `isAskDbRuntimeInitialized()`: it returns `true` once `bootstrapAskDbEnv()` has installed the runtime snapshot, so code that may run before or after its host's bootstrap can bootstrap only when it's needed (#280). `@askdb/http-api`'s `createAskDbHttpServer()` uses it.
