---
"askdb": patch
"@askdb/docs-site": patch
---

`askdb init` installs with the right package manager, on Windows too:

- **A new pnpm project installs with pnpm** (#750). With no lockfile, `init` fell back to npm, which refuses a project that `pnpm init` started (`EBADDEVENGINES`). It now reads `package.json`'s `packageManager` or `devEngines.packageManager` field, then the tool that ran it (`pnpm dlx`, `yarn dlx`, `npx`, `bunx`), before falling back to npm. An existing lockfile still wins.
- **The install runs on Windows** (#668). `init` spawned `pnpm.CMD`, `yarn.cmd` or `npm.cmd` without a shell, which Node refuses since its CVE-2024-27980 fix, so the install always failed. It now spawns the package manager as Studio does: allowlisted arguments, the bare command name, and a shell on Windows.
- **The command `init` prints when it doesn't install names the package manager it picked**, with the `@prisma/engines` build approval on pnpm 10.4 or later. At a workspace root, or with no `package.json`, it printed `npm install --save …`.
