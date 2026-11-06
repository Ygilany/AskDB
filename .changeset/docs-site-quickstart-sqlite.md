---
"@askdb/docs-site": patch
---

The Quickstart is now a single-path tutorial (#713). The reader creates a small SQLite shop database from a SQL file, installs the `askdb` CLI, runs `askdb init`, `introspect` and `ask`, then runs the returned SQL read-only with their own script, so every step shows a result. It uses npm only, since pnpm and Yarn fail in a new project today (#750, #748), and gives Postgres in Docker as the fallback where the SQLite driver has no prebuilt binary. The Install page notes that pnpm and Yarn install the previous AskDB version on release day, because both skip versions less than a day old.
