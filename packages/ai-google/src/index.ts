/**
 * @deprecated The Google Gemini provider is built into `@askdb/ai`; install
 * `@askdb/ai` + `@ai-sdk/google` and use `createAiRegistry(["google"])` (or
 * `createAiRegistry()` / `createAskDb({ config })`, which register every
 * built-in provider). This package re-exports it and will be removed before 1.0.
 */
export { googleProvider } from "@askdb/ai";
