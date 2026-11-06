---
"@askdb/enrich": patch
"@askdb/introspect": patch
"@askdb/prisma": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

Declare `ai` as a peer, with the range `@askdb/core` requires (`^6.0.0 || ^7.0.51`), so Yarn Plug'n'Play passes your app's `ai` through to `@askdb/core` (#748). Before, core inside these packages couldn't reach `ai` under Plug'n'Play, and `yarn dlx askdb` crashed at startup. Core already required `ai` when it loads, so npm and pnpm install nothing new, and a host that already meets core's `ai` range meets this one.
