---
"askdb": patch
---

`askdb init` now installs **`@askdb/config`** and **`dotenv`** in the nearest non-workspace package (detects pnpm / npm / yarn / bun via lockfiles). Workspace roots get copy-paste install instructions instead. Add **`--skip-install`** to only write `askdb.config.ts`.
