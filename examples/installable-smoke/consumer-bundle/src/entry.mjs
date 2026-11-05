// A host that bundles @askdb/client with esbuild and installs only the OpenAI SDK, at the
// oldest version @askdb/ai accepts. The bundle must build without the other @ai-sdk/*
// packages, and a provider whose SDK is missing must fail at runtime with the install hint.
// The same holds for the engine packages: the bundle builds without any database driver
// (pg, mysql2, better-sqlite3, mssql), and loading one fails at runtime with its install hint.
import assert from "node:assert/strict";
import { createAiRegistry } from "@askdb/ai";
import { createAskDb } from "@askdb/client";
import { loadMysql2Driver } from "@askdb/mysql";
import { loadPgDriver } from "@askdb/postgres";
import { loadBetterSqlite3Driver } from "@askdb/sqlite";
import { loadMssqlDriver } from "@askdb/sqlserver";

assert.equal(typeof createAskDb, "function");

const ai = createAiRegistry();
const openai = await ai.createLanguageModel({ provider: "openai", apiKey: "smoke-key", model: "gpt-4o-mini" });
assert.equal(openai.modelId, "gpt-4o-mini");

await assert.rejects(
  ai.createLanguageModel({ provider: "google", apiKey: "smoke-key", model: "gemini-2.0-flash" }),
  {
    message:
      "Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google",
  },
);

for (const [load, driver] of [
  [loadPgDriver, "pg"],
  [loadMysql2Driver, "mysql2"],
  [loadBetterSqlite3Driver, "better-sqlite3"],
  [loadMssqlDriver, "mssql"],
]) {
  await assert.rejects(load(), (error) => error.message.includes(`requires the optional \`${driver}\` peer dependency`));
}

console.log("smoke: bundled client and engine consumer OK");
