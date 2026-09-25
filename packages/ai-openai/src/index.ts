/**
 * @deprecated The OpenAI provider is built into `@askdb/ai`; install
 * `@askdb/ai` + `@ai-sdk/openai` and use `createAiRegistry(["openai"])` (or
 * `createAiRegistry()` / `createAskDb({ config })`, which register every
 * built-in provider). This package re-exports it and will be removed before 1.0.
 */
export { openaiProvider } from "@askdb/ai";
