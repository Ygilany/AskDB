---
"@askdb/config": patch
---

`isLikelyWorkspaceRoot()` in `@askdb/config/scaffold` counts a `pnpm-workspace.yaml` only when it lists at least one package under `packages` (#863). pnpm also keeps project settings in that file, such as `minimumReleaseAgeExclude`, so a one-package project with a settings-only file was read as a workspace root, and `askdb init` and Studio's guided setup skipped their install there. A `package.json` with `workspaces` still counts. The helper reads plain block YAML, and a file in any other form still counts as a workspace root.
