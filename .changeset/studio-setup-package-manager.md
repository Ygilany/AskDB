---
"@askdb/studio": patch
---

Studio's guided setup picks the package manager as `askdb init` does (#750): with no lockfile, from `package.json`'s `packageManager` or `devEngines.packageManager` field, then the tool that started Studio (`pnpm dlx`, `npx`, …), before falling back to npm. In a project that `pnpm init` started, setup used npm, which refuses it (`EBADDEVENGINES`). The execute-driver **Install** button still uses only the lockfile in the project's directory.
