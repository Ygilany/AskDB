---
"askdb": patch
---

`askdb init` installs `@askdb/config` and the driver in a one-package project whose `pnpm-workspace.yaml` holds only settings, such as `minimumReleaseAgeExclude` (#863). It skipped the install there and printed the `pnpm add` command. It still skips at a workspace root: a `pnpm-workspace.yaml` that lists at least one package under `packages`, or a `package.json` with `workspaces`.
