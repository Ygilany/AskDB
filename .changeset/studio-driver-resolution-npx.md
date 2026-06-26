---
"@askdb/studio": patch
---

Fix Studio driver detection when running via `npx askdb studio`.

Bare `import("mssql")` (or any other driver) resolves relative to the Studio binary in the npx cache, not the user's project, so drivers already installed in the project were always reported as missing. Replaced with `createRequire`-based resolution from the user's project root so that installed-check, execute, and post-install refresh all correctly reflect the project's own `node_modules`.
