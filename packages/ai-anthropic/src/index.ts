/**
 * @deprecated The Anthropic provider is built into `@askdb/ai`; install
 * `@askdb/ai` + `@ai-sdk/anthropic` and use `createAiRegistry(["anthropic"])`
 * (or `createAiRegistry()` / `createAskDb({ config })`, which register every
 * built-in provider). This package re-exports it and will be removed before 1.0.
 */
export { anthropicProvider } from "@askdb/ai";
