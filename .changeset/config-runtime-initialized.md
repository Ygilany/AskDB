---
"@askdb/config": minor
---

New export `isAskDbRuntimeInitialized()`: it returns `true` once `bootstrapAskDbEnv()` has installed the runtime snapshot, so code that may run before or after its host's bootstrap can bootstrap only when it's needed (#280). `@askdb/http-api`'s `createAskDbHttpServer()` uses it.

The runtime snapshot is now process-wide: it lives on `globalThis` under `Symbol.for("askdb.runtimeStore")` instead of in a module variable, so every copy of `@askdb/config` in a process sees the snapshot the host bootstrapped. Before, a host whose `@askdb/config` version differed from the one an app such as `@askdb/http-api` depends on had two separate snapshots, and the app saw none. Copies older than this release still keep their own.
