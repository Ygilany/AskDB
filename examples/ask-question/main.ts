/**
 * AskDB — "ask a question" example
 *
 * Simulates a downstream consumer importing @askdb/core and @askdb/rag to
 * translate a natural-language question into a SQL query using the schema
 * and configured AI provider.
 *
 * Two paths are shown:
 *   A) Basic — full schema is sent to the model on each call.
 *              Works well for schemas up to ~30 chunks (~10–15 tables).
 *   B) With RAG — a vector index narrows the schema context before calling
 *              the model. Better accuracy and lower token cost for large schemas.
 *
 * Configuration lives in askdb.config.ts (this directory). Copy .env.example
 * to .env and fill in your API key before running.
 *
 * Run with:
 *   bun main.ts
 *   npx tsx main.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import {
  ask,
  loadSchema,
} from "@askdb/core";
import { buildSchemaIndex, createMemoryStore, createAiSdkEmbedder } from "@askdb/rag";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ai = createAiRegistry([openaiProvider]);

// Load .env (if present) and evaluate askdb.config.ts in this directory,
// installing the AskDB runtime snapshot used by all subsequent calls.
bootstrapAskDbEnv({ cwd: __dirname });
const runtimeConfig = getAskDbRuntimeConfig();

// Point this at your own <schema-id>.schema/ directory.
// Here we reuse the fixture schema that ships with this repo.
const SCHEMA_DIR = path.resolve(
  __dirname,
  "../../fixtures/schemas/orders-users.schema",
);

const QUESTIONS = [
  "How much revenue did we make last month?",
  "Which customers placed the most orders?",
  "How many users signed up in the last 7 days?",
];

async function main(): Promise<void> {
  // ── 1. Load schema ─────────────────────────────────────────────────────────
  //
  // loadSchema accepts a .schema/ directory, a bundled JSON file, or a bare
  // schema.json path. It merges the physical layer (schema.json) with the
  // enrichment layer (tables/*.md, concepts.md) into a single normalized object.
  const schema = loadSchema(SCHEMA_DIR);

  console.log(`\nSchema: ${schema.schemaId} (${schema.tables.length} tables)`);
  for (const table of schema.tables) {
    console.log(`  · ${table.schema}.${table.name} — ${table.columns.length} columns`);
  }

  // ── 2. Build the language model from askdb.config.ts settings ─────────────
  //
  // runtimeConfig.ai.aiEnv is the canonical flat env map built from
  // askdb.config.ts. Passing it to the AI registry keeps all
  // provider selection, key lookup, and model defaulting in one place.
  const model = await ai.createLanguageModelFromEnv(runtimeConfig.ai.aiEnv);

  if (!model) {
    console.error(
      "\nNo API key configured. Set OPENAI_API_KEY in .env and retry.",
    );
    process.exit(1);
  }

  // ── 3. Path A — basic ask() with full schema context ───────────────────────
  console.log(
    "\n── A. Basic (full schema sent to model on every call) ─────────────────",
  );

  for (const question of QUESTIONS) {
    console.log(`\n  Q: ${question}`);
    const result = await ask({ question, schema, model, dialect: "postgres" });
    console.log(`  SQL: ${result.sql}`);
  }

  // ── 4. Path B — ask() with RAG (semantic retrieval) ───────────────────────
  //
  // For larger schemas (many tables / columns), build a vector index and pass
  // a retriever so only the relevant schema chunks are sent to the model.
  // createEmbeddingModelFromEnv uses the same config but defaults to the
  // embedding model (text-embedding-3-small) rather than the chat model.
  const embeddingModel = await ai.createEmbeddingModelFromEnv(
    runtimeConfig.ai.aiEnv,
  );

  if (!embeddingModel) {
    console.log("\nSkipping RAG path — no embedding key configured.");
    return;
  }

  // createAiSdkEmbedder bridges the AI SDK EmbeddingModel to the Embedder
  // interface expected by buildSchemaIndex.
  const embedder = createAiSdkEmbedder({ model: embeddingModel });

  // createMemoryStore keeps the index in-process.
  // Swap in createFileStore for a persistent disk cache, or
  // createPgvectorStore to store vectors in PostgreSQL.
  const index = await buildSchemaIndex({
    schema,
    embedder,
    store: createMemoryStore(),
    embedderId: "openai",
  });

  console.log(
    `\n── B. With RAG (${index.stats.chunksTotal} chunks indexed) ──────────────────────────`,
  );

  for (const question of QUESTIONS) {
    console.log(`\n  Q: ${question}`);
    const result = await ask({
      question,
      schema,
      model,
      dialect: "postgres",
      retriever: index.retriever,
      totalSchemaChunkCount: index.stats.chunksTotal,
      // Only activate retrieval when the schema exceeds this chunk count.
      // Below the threshold, the full schema fits in the prompt anyway.
      retrievalThresholdChunks: 20,
    });
    console.log(`  SQL: ${result.sql}`);
  }
}

main().catch((error: unknown) => {
  console.error("\nError:", error);
  process.exit(1);
});
