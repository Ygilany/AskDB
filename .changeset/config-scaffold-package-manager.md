---
"@askdb/config": minor
---

`@askdb/config/scaffold` exports the package-manager helpers `askdb init` and Studio share (#711): `detectPackageManager`, `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `lockfilePackageManager`, `packageManagerAddArgs`, `supportedBuildApprovals`, `formatInstallCommand`, `packageManagerSpawnSpec`, and the `PackageManager` and `PackageManagerSpawnSpec` types. The `@askdb/config/scaffold` entry point is tooling for `askdb init` and Studio, and experimental like Studio: a minor release of `@askdb/config` may change it (ADR 0030). `detectPackageManager` reads an existing lockfile first, then the nearest `package.json`'s `packageManager` or `devEngines.packageManager` field, then `npm_config_user_agent`, and falls back to npm (#750).
