/**
 * `@askdb/config/scaffold`: helpers for tools that write a new `askdb.config.ts`
 * (`askdb init`, Studio's setup wizard). Kept off the main entry, which user
 * configs import, so tooling can change without touching the config API.
 */
export { renderAskDbAiConfigScaffold } from "./ai.js";
export type { AskDbAiConfigScaffold, AskDbAiConfigScaffoldInput, AskDbScaffoldEnvVar } from "./ai.js";
