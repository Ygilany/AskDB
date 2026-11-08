---
"@askdb/docs-site": patch
---

The Quickstart's pnpm tab sets `minimumReleaseAgeExclude` for the project only, with `pnpm config set --location project` (#713). It lands in the folder's `pnpm-workspace.yaml`, and since 1.0.0-beta.52 `askdb init` still installs in a project whose `pnpm-workspace.yaml` holds only settings (#863). So the note that pnpm's setting stays in your user config, and how to undo it, is gone: both the pnpm and Yarn settings apply to this folder only. The pnpm sample output shows `@askdb/config` 1.0.0-beta.20, from a run against 1.0.0-beta.52.
