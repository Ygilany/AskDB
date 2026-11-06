/**
 * `@askdb/config/scaffold`: helpers for tools that set up a project and write a new
 * `askdb.config.ts` (`askdb init`, Studio's setup wizard). Kept off the main entry,
 * which user configs import, so tooling can change without touching the config API.
 *
 * @experimental Tooling for `askdb init` and AskDB Studio: a minor release of
 * `@askdb/config` may change these exports (ADR 0030).
 */
export { renderAskDbAiConfigScaffold } from "./ai.js";
export type { AskDbAiConfigScaffold, AskDbAiConfigScaffoldInput, AskDbScaffoldEnvVar } from "./ai.js";
export {
  detectPackageManager,
  findNearestPackageJsonDir,
  formatInstallCommand,
  isLikelyWorkspaceRoot,
  lockfilePackageManager,
  packageManagerAddArgs,
  packageManagerSpawnSpec,
  supportedBuildApprovals,
} from "./package-manager.js";
export type { PackageManager, PackageManagerSpawnSpec } from "./package-manager.js";
