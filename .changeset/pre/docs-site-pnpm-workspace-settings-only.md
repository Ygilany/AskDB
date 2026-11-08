---
"@askdb/docs-site": patch
---

The CLI and Studio references say what counts as a workspace root for `askdb init`'s and Studio's install: a `pnpm-workspace.yaml` that lists at least one package under `packages`, or a `package.json` with `workspaces`, and not a settings-only `pnpm-workspace.yaml`. The upgrade guide opens a 1.0.0-beta.52 section with the note (#863).
