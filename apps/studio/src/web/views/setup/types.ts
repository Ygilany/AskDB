import type { AskDbScaffoldAnswers } from "@askdb/config/scaffold";

// The planner in `@askdb/config/scaffold` ships Node code the browser bundle can't import, so
// the wizard keeps its own lists below; `setup-engines.test.ts` fails if they drift from it.
export type SetupDatabase = AskDbScaffoldAnswers["database"];
export type SetupAiProvider = "openai" | "anthropic" | "google" | "azure" | "foundry" | "gateway";
export type SetupRagStore = AskDbScaffoldAnswers["rag"]["store"];
export type SetupExecuteProvider = NonNullable<AskDbScaffoldAnswers["studioExecute"]>["provider"];

export const DATABASES: Array<{ value: SetupDatabase; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "prisma", label: "Prisma schema file (no live database)" },
];
/**
 * Mirrors `listBuiltinAiProviderSetups(ASKDB_AI_PROVIDERS)` from `@askdb/ai` (the browser bundle
 * can't import it). `setup-providers.test.ts` fails if the two drift. The Get-the-code panel
 * (`views/playground/GetTheCodePanel.tsx`) also reads its per-provider SDK wiring from here,
 * so there is exactly one copy of the provider table in the bundle.
 */
export type AiProviderWiring = {
  value: SetupAiProvider;
  label: string;
  keyEnv: string;
  modelEnv: string;
  /** SDK package the host must install; `undefined` when it ships with `ai` (gateway). */
  sdkPackage: string | undefined;
  /** Named import the generated snippet uses from the SDK package. */
  sdkImport: string;
  /** Model expression the generated snippet passes to `ask()`. */
  sdkModel: (model: string) => string;
};

export const AI_PROVIDERS: Array<AiProviderWiring> = [
  {
    value: "openai",
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    sdkPackage: "@ai-sdk/openai",
    sdkImport: "openai",
    sdkModel: (model) => `openai(${JSON.stringify(model)})`,
  },
  {
    value: "anthropic",
    label: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    sdkPackage: "@ai-sdk/anthropic",
    sdkImport: "anthropic",
    sdkModel: (model) => `anthropic(${JSON.stringify(model)})`,
  },
  {
    value: "google",
    label: "Google (Gemini)",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    modelEnv: "GOOGLE_AI_MODEL",
    sdkPackage: "@ai-sdk/google",
    sdkImport: "google",
    sdkModel: (model) => `google(${JSON.stringify(model)})`,
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    keyEnv: "AZURE_OPENAI_API_KEY",
    modelEnv: "AZURE_OPENAI_DEPLOYMENT",
    sdkPackage: "@ai-sdk/azure",
    sdkImport: "azure",
    sdkModel: (model) => `azure(${JSON.stringify(model)}) // your deployment name`,
  },
  {
    value: "foundry",
    label: "Azure AI Foundry",
    keyEnv: "AZURE_OPENAI_API_KEY",
    modelEnv: "AZURE_OPENAI_DEPLOYMENT",
    sdkPackage: "@ai-sdk/azure",
    sdkImport: "azure",
    sdkModel: (model) => `azure(${JSON.stringify(model)}) // your deployment name`,
  },
  {
    value: "gateway",
    label: "Vercel AI Gateway",
    keyEnv: "AI_GATEWAY_API_KEY",
    modelEnv: "ASKDB_AI_MODEL",
    sdkPackage: undefined,
    sdkImport: "gateway",
    sdkModel: (model) => `gateway(${JSON.stringify(model)})`,
  },
];
export const RAG_STORES: Array<{ value: SetupRagStore; label: string }> = [
  { value: "file", label: "File (default, no setup required)" },
  { value: "memory", label: "Memory (fast, non-persistent)" },
  { value: "pgvector", label: "pgvector (Postgres vector store)" },
];
export const EXECUTE_PROVIDERS: Array<{ value: SetupExecuteProvider; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
];
/** The connection URL variable each engine defaults to; `""` for an engine that reads no URL. */
export const CONNECTION_ENV_DEFAULTS: Record<SetupDatabase, string> = {
  postgres: "DATABASE_URL",
  mysql: "DATABASE_URL",
  sqlserver: "DATABASE_URL",
  sqlite: "",
  prisma: "",
};
export const EXECUTE_CONNECTION_ENV_DEFAULTS: Record<SetupExecuteProvider, string> = {
  postgres: "DATABASE_URL",
  mysql: "DATABASE_URL",
  sqlserver: "DATABASE_URL",
  sqlite: "",
};

