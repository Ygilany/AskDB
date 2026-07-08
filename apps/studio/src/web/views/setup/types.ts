export type SetupDatabase = "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
export type SetupAiProvider = "openai" | "anthropic" | "google" | "azure" | "foundry";
export type SetupRagStore = "file" | "memory" | "pgvector";
export type SetupExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

export const DATABASES: Array<{ value: SetupDatabase; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "prisma", label: "Prisma schema file (no live database)" },
];

export const AI_PROVIDERS: Array<{ value: SetupAiProvider; label: string; keyEnv: string; modelEnv: string }> = [
  { value: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL" },
  { value: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL" },
  { value: "google", label: "Google", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", modelEnv: "GOOGLE_GENERATIVE_AI_MODEL" },
  { value: "azure", label: "Azure OpenAI", keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT" },
  { value: "foundry", label: "Azure AI Foundry", keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT" },
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

export const CONNECTION_ENV_DEFAULTS: Record<SetupDatabase, string> = {
  postgres: "DATABASE_URL",
  mysql: "MYSQL_URL",
  sqlserver: "SQLSERVER_URL",
  sqlite: "",
  prisma: "",
};

export const EXECUTE_CONNECTION_ENV_DEFAULTS: Record<SetupExecuteProvider, string> = {
  postgres: "DATABASE_URL",
  mysql: "MYSQL_URL",
  sqlserver: "SQLSERVER_URL",
  sqlite: "",
};
