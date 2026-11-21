---
"@askdb/config": patch
---

`askdb init --database sqlite` now passes `--allow-build=better-sqlite3` to pnpm, so the scaffold install succeeds on pnpm 11.0–11.27 instead of failing with `[ERR_PNPM_IGNORED_BUILDS]`. The approval travels with the better-sqlite3 driver, so it also applies when SQLite is the Studio execute provider.
