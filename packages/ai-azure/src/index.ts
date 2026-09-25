/**
 * @deprecated The Azure OpenAI / Microsoft Foundry provider is built into
 * `@askdb/ai`; install `@askdb/ai` + `@ai-sdk/azure` and use
 * `createAiRegistry(["azure"])` (or `createAiRegistry()` / `createAskDb({ config })`,
 * which register every built-in provider). This package re-exports it and will
 * be removed before 1.0.
 */
export { azureProvider } from "@askdb/ai";
